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
    res.send(`Status WA Gateway: <b>${connectionStatus}</b><br> <a href="/qr">Klik di sini untuk melihat QR Code via Browser</a><br> <a href="/groups" target="_blank">Lihat Daftar Grup WhatsApp</a>`);
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

// 3. Endpoint Utama Kirim Pesan (Mendukung Nomor Pribadi & Grup @g.us)
app.post(['/send', '/send-message'], async (req, res) => {
    const { target, number, message } = req.body;
    const destination = target || number;

    if (connectionStatus !== 'CONNECTED') {
        return res.status(500).json({ success: false, message: 'WhatsApp belum terhubung/scan QR!' });
    }

    if (!destination || !message) {
        return res.status(400).json({ success: false, message: 'Tujuan dan pesan wajib diisi!' });
    }

    try {
        let jid;
        // Jika target berupa Group JID (mengandung @g.us)
        if (String(destination).includes('@g.us')) {
            jid = destination;
        } else {
            // Format nomor pribadi biasa
            let formattedTarget = destination.toString().replace(/\D/g, '');
            if (formattedTarget.startsWith('0')) {
                formattedTarget = '62' + formattedTarget.substring(1);
            }
            jid = formattedTarget + '@s.whatsapp.net';
        }

        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: 'Pesan berhasil dikirim ke tujuan!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.toString() });
    }
});

// 4. Endpoint Baru untuk Melihat Daftar Grup & JID-nya
app.get('/groups', async (req, res) => {
    if (connectionStatus !== 'CONNECTED') {
        return res.status(500).send('<h3>WhatsApp belum terhubung! Silakan scan QR terlebih dahulu.</h3>');
    }
    try {
        const groups = await sock.groupFetchAllParticipating();
        let list = '<div style="font-family:sans-serif; padding:20px;"><h2>Daftar Grup WhatsApp Bot</h2><p>Gunakan JID di bawah ini untuk tujuan broadcast:</p><ul>';
        for (let id in groups) {
            let groupName = groups[id].subject || 'Grup Tanpa Nama';
            list += `<li><b>${groupName}</b><br>JID: <code style="background:#eee; padding:2px 5px; user-select:all;">${id}</code></li><br>`;
        }
        list += '</ul></div>';
        res.send(list);
    } catch (err) {
        res.status(500).send('Gagal mengambil daftar grup: ' + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server WA Gateway berjalan di port ${PORT}`);
    connectToWhatsApp();
});
