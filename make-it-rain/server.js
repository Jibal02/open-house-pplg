const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const CONFIG = {
    W: 1200,
    H: 800,
    GROUND_Y: 730,
    BUCKET_TOP: 650,
    BUCKET_W: 80,
    PLAYER_HALF: 45,
    MOVE_SPEED: 420,
    TICK_HZ: 30,
    COUNTDOWN_MS: Number(process.env.COUNTDOWN_MS) || 5000,
    ROUND_MS: Number(process.env.ROUND_MS) || 90000,
    RESULT_MS: Number(process.env.RESULT_MS) || 10000,
    PUNCH_RANGE: 90,
    PUNCH_COOLDOWN_MS: 900,
    PUNCH_ANIM_MS: 180,
    STUN_MS: 700,
    KNOCKBACK: 45,
    STEAL_RATIO: 0.25,
    STEAL_MIN: 1,
    STEAL_MAX: 6,
    SPILL_CHANCE: 0.3,
    SPILL_MAX: 2,
    HIT_IMMUNITY_MS: 500,
    JOIN_PROTECTION_MS: 2000,
    COIN_SPAWN_BASE: 3,
    COIN_SPAWN_RUSH: 1.8,
    RUSH_LAST_MS: 15000,
    MAX_NAME: 16,
    COIN_TIERS: [
        { weight: 70, value: 1, radius: 9, color: '#facc15' },
        { weight: 24, value: 5, radius: 13, color: '#fbbf24' },
        { weight: 6, value: 10, radius: 16, color: '#fde047' }
    ]
};

const COLORS = [
    '#38bdf8', '#f472b6', '#34d399', '#fb923c', '#a78bfa',
    '#facc15', '#22d3ee', '#f87171', '#4ade80', '#c084fc'
];

let players = {};
let coins = [];
let phase = 'waiting';
let phaseEndsAt = 0;
let roundNo = 0;
let hallOfFame = [];
let spawnAcc = 0;
let coinId = 0;
let colorIndex = 0;
let lastTime = Date.now();

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function sanitizeName(raw) {
    const name = String(raw || '')
        .trim()
        .replace(/[<>\u0000-\u001f]/g, '')
        .slice(0, CONFIG.MAX_NAME);
    return name || 'Anonim';
}

function coinStyle(value) {
    if (value >= 10) return { radius: 16, color: '#fde047' };
    if (value >= 5) return { radius: 13, color: '#fbbf24' };
    return { radius: 9, color: '#facc15' };
}

function spawnCoin() {
    const roll = Math.random() * 100;
    let acc = 0;
    let tier = CONFIG.COIN_TIERS[0];
    for (const t of CONFIG.COIN_TIERS) {
        acc += t.weight;
        if (roll <= acc) {
            tier = t;
            break;
        }
    }
    coins.push({
        id: ++coinId,
        x: 60 + Math.random() * (CONFIG.W - 120),
        y: -30,
        vx: (Math.random() - 0.5) * 30,
        vy: 230 + Math.random() * 190,
        value: tier.value,
        radius: tier.radius,
        color: tier.color
    });
}

function spawnSpill(x, y, value, vx, vy) {
    const style = coinStyle(value);
    coins.push({
        id: ++coinId,
        x: clamp(x, style.radius, CONFIG.W - style.radius),
        y: y,
        vx: vx,
        vy: vy,
        value: value,
        radius: style.radius,
        color: style.color
    });
}

function startCountdown() {
    roundNo++;
    phase = 'countdown';
    phaseEndsAt = Date.now() + CONFIG.COUNTDOWN_MS;
}

function startRound() {
    coins = [];
    spawnAcc = 0;

    const ids = Object.keys(players);
    ids.forEach((id, index) => {
        const p = players[id];
        p.x = ids.length > 1
            ? 100 + (CONFIG.W - 200) * (index / (ids.length - 1))
            : CONFIG.W / 2;
        p.gold = 0;
        p.totalCaught = 0;
        p.stunMs = 0;
        p.punchMs = 0;
        p.punchCooldownMs = 0;
        p.immuneMs = 0;
        p.lastHitBy = null;
        p.lastHitMs = 0;
        p.left = false;
        p.right = false;
    });

    phase = 'playing';
    phaseEndsAt = Date.now() + CONFIG.ROUND_MS;
}

function endRound() {
    phase = 'results';
    phaseEndsAt = Date.now() + CONFIG.RESULT_MS;

    const ranking = Object.values(players).sort((a, b) =>
        b.gold - a.gold || b.totalCaught - a.totalCaught || a.nama.localeCompare(b.nama)
    );
    if (ranking.length > 0) {
        hallOfFame.unshift({
            roundNo: roundNo,
            nama: ranking[0].nama,
            gold: ranking[0].gold,
            color: ranking[0].color
        });
        hallOfFame = hallOfFame.slice(0, 5);
    }
}

io.on('connection', (socket) => {
    socket.on('join', (rawName) => {
        players[socket.id] = {
            id: socket.id,
            nama: sanitizeName(rawName),
            x: 100 + Math.random() * (CONFIG.W - 200),
            color: COLORS[colorIndex++ % COLORS.length],
            gold: 0,
            totalCaught: 0,
            stunMs: 0,
            punchMs: 0,
            punchCooldownMs: 0,
            punchDir: 1,
            immuneMs: CONFIG.JOIN_PROTECTION_MS,
            lastHitBy: null,
            lastHitMs: 0,
            left: false,
            right: false
        };

        if (phase === 'waiting') startCountdown();
    });

    socket.on('input', (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.left = !!data.left;
        p.right = !!data.right;
        if (p.left) p.punchDir = -1;
        else if (p.right) p.punchDir = 1;
    });

    socket.on('punch', () => {
        const p = players[socket.id];
        if (!p || phase !== 'playing' || p.stunMs > 0 || p.punchCooldownMs > 0) return;

        p.punchCooldownMs = CONFIG.PUNCH_COOLDOWN_MS;
        p.punchMs = CONFIG.PUNCH_ANIM_MS;

        let target = null;
        let best = Infinity;
        for (const id in players) {
            if (id === socket.id) continue;
            const other = players[id];
            const distance = Math.abs(other.x - p.x);
            if (distance <= CONFIG.PUNCH_RANGE && distance < best) {
                best = distance;
                target = other;
            }
        }

        if (!target) return;

        p.punchDir = target.x >= p.x ? 1 : -1;
        if (target.immuneMs > 0) return;

        const wanted = Math.max(CONFIG.STEAL_MIN, Math.ceil(target.gold * CONFIG.STEAL_RATIO));
        const stolen = Math.min(wanted, CONFIG.STEAL_MAX, target.gold);
        target.gold -= stolen;
        p.gold += stolen;

        const away = target.x >= p.x ? 1 : -1;
        target.x = clamp(
            target.x + away * CONFIG.KNOCKBACK,
            CONFIG.PLAYER_HALF,
            CONFIG.W - CONFIG.PLAYER_HALF
        );
        target.stunMs = CONFIG.STUN_MS;
        target.immuneMs = CONFIG.HIT_IMMUNITY_MS;
        target.lastHitBy = p.id;
        target.lastHitMs = 500;

        if (Math.random() < CONFIG.SPILL_CHANCE && target.gold > 0) {
            const spilled = Math.min(
                Math.max(1, Math.ceil(stolen / 2)),
                CONFIG.SPILL_MAX,
                target.gold
            );
            target.gold -= spilled;
            spawnSpill(
                target.x,
                CONFIG.BUCKET_TOP - 20,
                spilled,
                (Math.random() - 0.5) * 180,
                -240 - Math.random() * 120
            );
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length === 0) {
            phase = 'waiting';
            phaseEndsAt = 0;
            coins = [];
        }
    });
});

function tick() {
    const now = Date.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (phase === 'countdown' && now >= phaseEndsAt) {
        startRound();
    } else if (phase === 'playing' && now >= phaseEndsAt) {
        endRound();
    } else if (phase === 'results' && now >= phaseEndsAt) {
        if (Object.keys(players).length > 0) startCountdown();
        else {
            phase = 'waiting';
            phaseEndsAt = 0;
        }
    }

    if (phase === 'playing') {
        for (const p of Object.values(players)) {
            p.stunMs = Math.max(0, p.stunMs - dt * 1000);
            p.punchMs = Math.max(0, p.punchMs - dt * 1000);
            p.punchCooldownMs = Math.max(0, p.punchCooldownMs - dt * 1000);
            p.immuneMs = Math.max(0, p.immuneMs - dt * 1000);
            p.lastHitMs = Math.max(0, p.lastHitMs - dt * 1000);

            if (p.stunMs <= 0) {
                const dir = (p.right ? 1 : 0) - (p.left ? 1 : 0);
                p.x = clamp(
                    p.x + dir * CONFIG.MOVE_SPEED * dt,
                    CONFIG.PLAYER_HALF,
                    CONFIG.W - CONFIG.PLAYER_HALF
                );
            }
        }

        const timeLeft = Math.max(0, phaseEndsAt - now);
        const rate = CONFIG.COIN_SPAWN_BASE
            * (timeLeft <= CONFIG.RUSH_LAST_MS ? CONFIG.COIN_SPAWN_RUSH : 1);
        spawnAcc += rate * dt;
        while (spawnAcc >= 1) {
            spawnCoin();
            spawnAcc -= 1;
        }

        for (let i = coins.length - 1; i >= 0; i--) {
            const c = coins[i];
            c.vy = Math.min(c.vy + 520 * dt, 700);
            c.x += c.vx * dt;
            c.y += c.vy * dt;

            if (c.x < c.radius || c.x > CONFIG.W - c.radius) {
                c.vx *= -1;
                c.x = clamp(c.x, c.radius, CONFIG.W - c.radius);
            }

            let caught = false;
            if (c.vy > 0 && c.y + c.radius >= CONFIG.BUCKET_TOP && c.y - c.radius <= CONFIG.BUCKET_TOP + 24) {
                for (const p of Object.values(players)) {
                    if (Math.abs(c.x - p.x) <= CONFIG.BUCKET_W / 2) {
                        p.gold += c.value;
                        p.totalCaught += c.value;
                        caught = true;
                        break;
                    }
                }
            }

            if (caught || c.y - c.radius > CONFIG.GROUND_Y) coins.splice(i, 1);
        }
    }

    io.emit('state', {
        phase: phase,
        roundNo: roundNo,
        timeLeftMs: phase === 'waiting' ? 0 : Math.max(0, phaseEndsAt - Date.now()),
        players: players,
        coins: coins,
        winner: phase === 'results' && hallOfFame.length ? hallOfFame[0] : null,
        hallOfFame: hallOfFame
    });
}

setInterval(tick, 1000 / CONFIG.TICK_HZ);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Make It Rain jalan di port ${PORT}`);
});
