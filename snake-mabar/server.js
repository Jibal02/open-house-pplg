const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const CANVAS_W = 1200;
const CANVAS_H = 800;
const BASE_PLAYER_SPEED = 5;
const BOOSTED_PLAYER_SPEED = 9; // Kecepatan saat dapaet item boost
const DRAGON_SPEED = 3;

let players = {};
let gems = [];
let speedBoosts = []; // Array untuk item speed boost ⚡

for (let i = 0; i < 30; i++) gems.push(randomPos());
for (let i = 0; i < 5; i++) speedBoosts.push(randomPos()); // Spawns 5 item speed boost

let dragons = [];

function randomPos() {
    return {
        x: Math.floor(Math.random() * (CANVAS_W - 50)) + 25,
        y: Math.floor(Math.random() * (CANVAS_H - 50)) + 25
    };
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            nama: data.nama || 'Hero',
            role: data.role,
            x: Math.random() * (CANVAS_W - 50) + 25,
            y: Math.random() * (CANVAS_H - 50) + 25,
            score: 0,
            speedBoostTimer: 0, // Frame counter durasi boost
            keys: { up: false, down: false, left: false, right: false },
            isGameOver: false
        };

        dragons.push({
            x: CANVAS_W / 2,
            y: CANVAS_H / 2,
            dx: DRAGON_SPEED * (Math.random() > 0.5 ? 1 : -1),
            dy: DRAGON_SPEED * (Math.random() > 0.5 ? 1 : -1)
        });
    });

    socket.on('keyState', (keys) => {
        if (players[socket.id]) {
            players[socket.id].keys = keys;
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            dragons.pop();
        }
    });
});

setInterval(() => {
    // Update Naga
    dragons.forEach(dragon => {
        dragon.x += dragon.dx;
        dragon.y += dragon.dy;
        if (dragon.x <= 20 || dragon.x >= CANVAS_W - 20) dragon.dx *= -1;
        if (dragon.y <= 20 || dragon.y >= CANVAS_H - 20) dragon.dy *= -1;
    });

    for (let id in players) {
        let p = players[id];

        if (p.isGameOver) continue;

        // Tentukan Kecepatan Aktif & kurangi timer boost jika aktif
        let currentSpeed = BASE_PLAYER_SPEED;
        if (p.speedBoostTimer > 0) {
            currentSpeed = BOOSTED_PLAYER_SPEED;
            p.speedBoostTimer--;
        }

        // Update Posisi Pemain berdasarkan speed aktif
        if (p.keys.up && p.y > 20) p.y -= currentSpeed;
        if (p.keys.down && p.y < CANVAS_H - 20) p.y += currentSpeed;
        if (p.keys.left && p.x > 20) p.x -= currentSpeed;
        if (p.keys.right && p.x < CANVAS_W - 20) p.x += currentSpeed;

        // Cek Tabrakan dengan Permata
        for (let i = 0; i < gems.length; i++) {
            let dx = p.x - gems[i].x;
            let dy = p.y - gems[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) {
                p.score += 10;
                gems[i] = randomPos();
            }
        }

        // Cek Tabrakan dengan Item Speed Boost ⚡
        for (let i = 0; i < speedBoosts.length; i++) {
            let dx = p.x - speedBoosts[i].x;
            let dy = p.y - speedBoosts[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) {
                p.speedBoostTimer = 150; // Efek boost aktif selama ~5 detik (150 tick @ 30 FPS)
                speedBoosts[i] = randomPos();
            }
        }

        // Cek Tabrakan dengan Naga
        for (let dragon of dragons) {
            let dX = p.x - dragon.x;
            let dY = p.y - dragon.y;
            if (Math.sqrt(dX * dX + dY * dY) < 40) {
                p.isGameOver = true;
                break;
            }
        }
    }

    // Kirim state baru termasuk 'speedBoosts'
    io.emit('gameState', { players, gems, dragons, speedBoosts });
}, 1000 / 30);

server.listen(3000, '0.0.0.0', () => {
    console.log('Server Adventure jalan di port 3000');
});