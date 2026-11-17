const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 1. Peta diperbesar agar layar monitor besar tidak menyentuh ujung dengan cepat
const CANVAS_W = 3000;
const CANVAS_H = 2000;
const MAX_FOOD = 400; // Makanan ditambah menyesuaikan luas peta

let players = {};
let foods = [];

function spawnFood() {
    return {
        x: Math.random() * CANVAS_W,
        y: Math.random() * CANVAS_H,
        color: `hsl(${Math.random() * 360}, 100%, 60%)`
    };
}

for (let i = 0; i < MAX_FOOD; i++) foods.push(spawnFood());

io.on('connection', (socket) => {
    socket.on('joinGame', (nama) => {
        players[socket.id] = {
            id: socket.id,
            nama: nama || 'Bot',
            x: Math.random() * CANVAS_W,
            y: Math.random() * CANVAS_H,
            radius: 20,
            score: 0,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            targetX: 0,
            targetY: 0,
            isGameOver: false
        };
    });

    socket.on('move', (target) => {
        if (players[socket.id]) {
            players[socket.id].targetX = target.x;
            players[socket.id].targetY = target.y;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

setInterval(() => {
    let activePlayers = Object.values(players).filter(p => !p.isGameOver);

    activePlayers.forEach(p => {
        let dx = p.targetX - p.x;
        let dy = p.targetY - p.y;
        let dist = Math.hypot(dx, dy);

        let speed = Math.max(1, 6 - (p.radius / 30));

        if (dist > 5) {
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
        }

        p.x = Math.max(p.radius, Math.min(CANVAS_W - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(CANVAS_H - p.radius, p.y));

        for (let i = foods.length - 1; i >= 0; i--) {
            let f = foods[i];
            let distToFood = Math.hypot(p.x - f.x, p.y - f.y);
            if (distToFood < p.radius + 5) {
                p.score += 5;
                p.radius += 0.5;
                foods.splice(i, 1);
                foods.push(spawnFood());
            }
        }

        activePlayers.forEach(other => {
            if (p.id !== other.id) {
                let distToOther = Math.hypot(p.x - other.x, p.y - other.y);
                if (distToOther < p.radius && p.radius > other.radius * 1.1) {
                    p.score += Math.floor(other.score / 2);
                    p.radius += other.radius * 0.3;
                    other.isGameOver = true;
                }
            }
        });
    });

    io.emit('gameState', { players, foods });
}, 1000 / 30);

server.listen(3000, '0.0.0.0', () => {
    console.log('Server Data Eater berjalan di port 3000');
});