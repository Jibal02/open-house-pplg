const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 1. Ukuran Canvas Diperbesar
const CANVAS_W = 1200;
const CANVAS_H = 800;
const PLAYER_SPEED = 5;
const DRAGON_SPEED = 3;

let players = {};
let gems = [];
// Permata diperbanyak menjadi 30 agar cukup untuk 10 siswa
for (let i = 0; i < 30; i++) gems.push(randomPos());

// 2. Naga sekarang berbentuk Array (banyak)
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
            keys: { up: false, down: false, left: false, right: false },
            isGameOver: false
        };

        // 3. Tambah 1 Naga setiap ada 1 pemain masuk
        dragons.push({
            x: CANVAS_W / 2, // Muncul di tengah
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
        // Hapus pemain dan kurangi 1 naga jika pemain tersebut sudah join
        if (players[socket.id]) {
            delete players[socket.id];
            dragons.pop();
        }
    });
});

setInterval(() => {
    // 4. Update Posisi SEMUA Naga
    dragons.forEach(dragon => {
        dragon.x += dragon.dx;
        dragon.y += dragon.dy;
        if (dragon.x <= 20 || dragon.x >= CANVAS_W - 20) dragon.dx *= -1;
        if (dragon.y <= 20 || dragon.y >= CANVAS_H - 20) dragon.dy *= -1;
    });

    for (let id in players) {
        let p = players[id];

        if (p.isGameOver) continue;

        // Update Posisi Pemain
        if (p.keys.up && p.y > 20) p.y -= PLAYER_SPEED;
        if (p.keys.down && p.y < CANVAS_H - 20) p.y += PLAYER_SPEED;
        if (p.keys.left && p.x > 20) p.x -= PLAYER_SPEED;
        if (p.keys.right && p.x < CANVAS_W - 20) p.x += PLAYER_SPEED;

        // Cek Tabrakan dengan Permata
        for (let i = 0; i < gems.length; i++) {
            let dx = p.x - gems[i].x;
            let dy = p.y - gems[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < 30) {
                p.score += 10;
                gems[i] = randomPos();
            }
        }

        // 5. Cek Tabrakan dengan SEMUA Naga
        for (let dragon of dragons) {
            let dX = p.x - dragon.x;
            let dY = p.y - dragon.y;
            if (Math.sqrt(dX * dX + dY * dY) < 40) {
                p.isGameOver = true;
                break; // Jika sudah tertabrak 1 naga, langsung mati (hemat memori)
            }
        }
    }

    // Kirim data 'dragons' (array), bukan lagi 'dragon' (objek tunggal)
    io.emit('gameState', { players, gems, dragons });
}, 1000 / 30);

server.listen(3000, '0.0.0.0', () => {
    console.log('Server Adventure jalan di port 3000');
});