const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

let sock;
let qrCodeData = '';
let connectionStatus = 'DISCONNECTED';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log('\n--- SCAN QR CODE DI BAWAH INI ---');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('-----------------------------------');
            console.log('Atau buka browser: http://localhost:3000/qr\n');
        }

        if (connection === 'close') {
            connectionStatus = 'DISCONNECTED';
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'CONNECTED';
            qrCodeData = '';
            console.log('WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// 1. Endpoint Cek Status Server
app.get('/', (req, res) => {
    res.send(`Status WA Gateway: <b>${connectionStatus}</b><br> <a href="/qr">Klik di sini untuk melihat QR Code via Browser</a>`);
});

// 2. Endpoint Khusus Tampilkan QR Code di Browser
app.get('/qr', async (req, res) => {
    if (connectionStatus === 'CONNECTED') {
        return res.send('<h3>WhatsApp sudah terhubung! Tidak perlu scan QR lagi.</h3>');
    }
    if (!qrCodeData) {
        return res.send('<h3>QR Code sedang disiapkan, silakan refresh halaman ini dalam beberapa detik...</h3>');
    }
    try {
        let urlImage = await qrcode.toDataURL(qrCodeData);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h2>Scan QR Code WhatsApp Gateway</h2>
                <p>Buka WhatsApp di HP -> Perangkat Tertaut -> Tautkan Perangkat</p>
                <img src="${urlImage}" alt="QR Code" style="width:300px; height:300px; border:1px solid #ccc; padding:10px; border-radius:10px;" />
            </div>
        `);
    } catch (err) {
        res.status(500).send('Gagal generate QR Code');
    }
});

// 3. Endpoint Utama Kirim Pesan (Mendukung '/send' dan '/send-message')
app.post(['/send', '/send-message'], async (req, res) => {
    const { target, number, message, token } = req.body;
    const destination = target || number; // Mendukung format payload dari GAS maupun manual

    if (connectionStatus !== 'CONNECTED') {
        return res.status(500).json({ success: false, message: 'WhatsApp belum terhubung/scan QR!' });
    }

    if (!destination || !message) {
        return res.status(400).json({ success: false, message: 'Nomor tujuan dan pesan wajib diisi!' });
    }

    try {
        let formattedTarget = destination.toString().replace(/\D/g, '');
        if (formattedTarget.startsWith('0')) {
            formattedTarget = '62' + formattedTarget.substring(1);
        }
        const jid = formattedTarget + '@s.whatsapp.net';

        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: 'Pesan berhasil dikirim!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.toString() });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server WA Gateway berjalan di port ${PORT}`);
    connectToWhatsApp();
});
