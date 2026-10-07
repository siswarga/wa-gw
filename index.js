const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const fs = require('fs');

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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log('\n--- SCAN QR CODE DI BAWAH INI ---');
            qrcodeTerminal.generate(qr, { small: true });
            console.log('-----------------------------------');
        }

        if (connection === 'close') {
            connectionStatus = 'DISCONNECTED';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Koneksi terputus. Status Code: ${statusCode}`);
            
            // Jika sesi korup atau logout, bersihkan folder auth agar QR baru muncul
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('Sesi kedaluwarsa, membersihkan data sesi lama...');
                try {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                } catch (e) {}
            }

            const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log('Koneksi berhenti. Silakan restart aplikasi.');
                qrCodeData = '';
            }
        } else if (connection === 'open') {
            connectionStatus = 'CONNECTED';
            qrCodeData = '';
            console.log('WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/', (req, res) => {
    res.send(`Status WA Gateway: <b>${connectionStatus}</b><br><a href="/qr">Klik di sini untuk melihat QR Code via Browser</a>`);
});

app.get('/qr', async (req, res) => {
    if (connectionStatus === 'CONNECTED') {
        return res.send('<h3>WhatsApp sudah terhubung!</h3>');
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

app.post(['/send', '/send-message'], async (req, res) => {
    const { target, number, message } = req.body;
    const destination = target || number;

    if (connectionStatus !== 'CONNECTED') {
        return res.status(500).json({ success: false, message: 'WhatsApp belum terhubung!' });
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
    console.log(`Server berjalan di port ${PORT}`);
    connectToWhatsApp();
});
