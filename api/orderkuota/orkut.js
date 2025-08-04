const axios = require('axios');
const FormData = require('form-data');
const QRCode = require('qrcode');
const { Readable } = require('stream');
const { fromBuffer } = require('file-type');
const qs = require('qs');
const fetch = require('node-fetch');

// Constants
const API_URL = 'https://app.orderkuota.com:443/api/v2';
const APP_VERSION_NAME = '25.03.14';
const APP_VERSION_CODE = '250314';
const APP_REG_ID = 'di309HvATsaiCppl5eDpoc:APA91bFUcTOH8h2XHdPRz2qQ5Bezn-3_TaycFcJ5pNLGWpmaxheQP9Ri0E56wLHz0_b1vcss55jbRQXZgc9loSfBdNa5nZJZVMlk7GS1JDMGyFUVvpcwXbMDg8tjKGZAurCGR4kDMDRJ';

// Helper functions
function convertCRC16(str) {
    let crc = 0xFFFF;
    const strlen = str.length;
    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    let hex = crc & 0xFFFF;
    hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);
    return hex;
}

function generateTransactionId() {
    const randomString = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `WHYUSTR-${randomString}`;
}

function generateExpirationTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30);
    return now.toISOString();
}

// Upload function
const uploadToSupaCodes = async (fileBuffer) => {
    try {
        const formData = new FormData();
        formData.append('image', fileBuffer, {
            filename: 'upload.png',
            contentType: 'image/png'
        });

        const response = await axios.post('https://tourl.fahri-hosting.xyz/upload.php', formData, {
            headers: formData.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: () => true
        });

        const text = response.data;

        if (typeof text === 'string' && text.startsWith('http')) {
            return text.trim();
        } else {
            throw new Error(`Upload error: Unexpected response from upload.php: ${text}`);
        }
    } catch (error) {
        throw new Error(`Upload error: ${error.message}`);
    }
};

// QRIS functions
async function createQRIS(amount, codeqr) {
    if (!codeqr) throw new Error("QRIS code is required");

    let qrisData = codeqr.slice(0, -4);
    const step1 = qrisData.replace("010211", "010212");
    const step2 = step1.split("5802ID");

    amount = parseInt(amount).toString();
    let uang = "54" + ("0" + amount.length).slice(-2) + amount;
    uang += "5802ID";

    const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(result)}`;

    return {
        transactionId: generateTransactionId(),
        amount: amount,
        expirationTime: generateExpirationTime(),
        qrImageUrl: qrImageUrl,
        qrString: result
    };
}

async function getMutasiQrisFromOrkut({
    username,
    password,
    authToken,
    type = '',
    page = 1,
    jumlah = '',
    dari_tanggal = '',
    ke_tanggal = '',
    keterangan = ''
}) {
    const HEADERS = {
        Host: 'app.orderkuota.com',
        'User-Agent': 'okhttp/4.10.0',
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    const payload = qs.stringify({
        auth_token: authToken,
        auth_username: username,
        auth_password: password,
        [`requests[qris_history][jenis]`]: type,
        'requests[qris_history][jumlah]': jumlah,
        'requests[qris_history][page]': page,
        'requests[qris_history][dari_tanggal]': dari_tanggal,
        'requests[qris_history][ke_tanggal]': ke_tanggal,
        'requests[qris_history][keterangan]': keterangan,
        'requests[0]': 'account',
        app_version_name: APP_VERSION_NAME,
        app_version_code: APP_VERSION_CODE,
        app_reg_id: APP_REG_ID,
    });

    try {
        const { data } = await axios.post(`${API_URL}/get`, payload, {
            headers: HEADERS,
            timeout: 15000,
            validateStatus: () => true
        });

        return data;
    } catch (error) {
        console.error('Error fetching Orkut API:', error.message);
        return {
            success: false,
            qris_history: {
                success: false,
                message: `Error koneksi ke Orkut: ${error.message}`,
                results: []
            }
        };
    }
}

// Export the route handlers
module.exports = function(app) {
    app.get('/orderkuota/createpayment', async (req, res) => {
    const { apikey } = req.query
            if (!global.apikey.includes(apikey)) return res.json({ status: false, error: 'Apikey invalid' });
        const { amount, codeqr } = req.query;
        if (!amount) return res.json("Isi Parameter Amount.");
        if (!codeqr) return res.json("Isi Parameter CodeQr menggunakan qris code kalian.");

        try {
            const qrData = await createQRIS(amount, codeqr);

            // Telegram notification (async)
            const telegramBotToken = '7971448254:AAFaxNM4M23LIiKpqc2q84BOxBJSATv2vds';
            const chatId = '6682418964';
            const message = `
🚨 *Notifikasi Pembayaran Baru* 🚨

💰 *Jumlah Pembayaran*: Rp ${amount}
🔳 *Kode QR*: ${codeqr}

Pembayaran baru telah berhasil dibuat menggunakan kode QR Anda.`;

            fetch(`https://api.telegram.org/bot${telegramBotToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: qrData.qrImageUrl,
                    caption: message,
                    parse_mode: 'Markdown'
                })
            }).catch(err => console.error("Telegram Error:", err));

            res.json({
                status: true,
                creator: "Wahyu-Store",
                result: qrData
            });
        } catch (error) {
            console.error("Error:", error);
            res.status(500).json({ error: error.message });
        }
    }); // This closing bracket was missing

    app.get('/orderkuota/cekstatus', async (req, res) => {
    const { apikey, username, password, authToken } = req.query;

    // Validasi apikey
    if (!global.apikey.includes(apikey)) {
        return res.json({ status: false, error: 'Apikey invalid' });
    }

    // Validasi parameter
    if (!username) return res.json({ status: false, error: "Isi Parameter Username." });
    if (!password) return res.json({ status: false, error: "Isi Parameter Password." });
    if (!authToken) return res.json({ status: false, error: "Isi Parameter Auth Token." });

    try {
        const apiUrl = `https://wahyustr-orderkuota-com.vercel.app/orderkuota/mutasi?apikey=${apikey}&username=${username}&password=${password}&auth_token=${authToken}`;
        const response = await fetch(apiUrl);
        const result = await response.json();

        if (result.status && result.data) {
            const trx = result.data;

            res.json({
                status: true,
                creator: result.creator || "Unknown",
                data: {
                    id: trx.id,
                    tanggal: trx.tanggal,
                    keterangan: trx.keterangan,
                    amount_in: trx.kredit || "0",
                    amount_out: trx.debet || "0",
                    balance: trx.saldo_akhir,
                    transaction_status: trx.status,
                    fee: trx.fee || "0",
                    brand_name: trx.brand?.name || "UNKNOWN",
                    brand_logo: trx.brand?.logo || null,
                    type: trx.status === "IN" ? "Masuk" : "Keluar"
                }
            });
        } else {
            res.json({
                status: false,
                message: result.message || "Transaksi tidak ditemukan."
            });
        }
    } catch (err) {
        res.status(500).json({
            status: false,
            error: err.message
        });
    }
});
    
    app.get('/orderkuota/login', async (req, res) => {
    const { apikey } = req.query
            if (!global.apikey.includes(apikey)) return res.json({ status: false, error: 'Apikey invalid' });
        const { username, password } = req.query;

        const payload = qs.stringify({
            username,
            password,
            app_reg_id: APP_REG_ID,
            app_version_code: APP_VERSION_CODE,
            app_version_name: APP_VERSION_NAME,
        });

        try {
            const response = await axios.post(`${API_URL}/login`, payload, {
                headers: {
                    Host: 'app.orderkuota.com',
                    'User-Agent': 'okhttp/4.10.0',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 10000,
            });

            res.json(response.data);
        } catch (error) {
            res.status(500).json({
                error: true,
                message: error.message,
                details: error.response?.data || null,
            });
        }
    });

    app.get('/orderkuota/verify-otp', async (req, res) => {
    const { apikey } = req.query
            if (!global.apikey.includes(apikey)) return res.json({ status: false, error: 'Apikey invalid' });
        const { username, otp } = req.query;

        const payload = qs.stringify({
            username,
            password: otp,
            app_reg_id: APP_REG_ID,
            app_version_code: APP_VERSION_CODE,
            app_version_name: APP_VERSION_NAME,
        });

        try {
            const response = await axios.post(`${API_URL}/login`, payload, {
                headers: {
                    Host: 'app.orderkuota.com',
                    'User-Agent': 'okhttp/4.10.0',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 10000,
            });

            res.json(response.data);
        } catch (error) {
            res.status(500).json({
                error: true,
                message: error.message,
                details: error.response?.data || null,
            });
        }
    });

    app.get('/orderkuota/mutasi', async (req, res) => {
    const { apikey } = req.query
            if (!global.apikey.includes(apikey)) return res.json({ status: false, error: 'Apikey invalid' });
        try {
            const {
                username,
                password,
                auth_token,
                type = '',
                page = 1,
                jumlah = '',
                dari_tanggal = '',
                ke_tanggal = '',
                keterangan = ''
            } = req.query;

            if (!username || !password || !auth_token) {
                return res.status(400).json({
                    status: false,
                    message: 'Parameter username dan auth_token wajib diisi',
                    data: null
                });
            }

            const result = await getMutasiQrisFromOrkut({
                username,
                password,
                authToken: auth_token,
                type,
                page: parseInt(page),
                jumlah,
                dari_tanggal,
                ke_tanggal,
                keterangan
            });

            const transaksi = result?.qris_history?.results;
            if (!Array.isArray(transaksi) || transaksi.length === 0) {
                return res.status(200).json({
                    status: false,
                    message: 'Tidak ada transaksi ditemukan',
                    data: null
                });
            }

            const sorted = transaksi.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
            const latest = sorted[0];

            return res.status(200).json({
                status: true,
                data: {
                    id: latest.id,
                    debet: latest.debet || '0',
                    kredit: latest.kredit || '0',
                    saldo_akhir: latest.saldo_akhir || '0',
                    keterangan: latest.keterangan?.trim() || '',
                    tanggal: latest.tanggal,
                    status: latest.status || '',
                    fee: latest.fee || '',
                    brand: {
                        name: latest.brand?.name || '',
                        logo: latest.brand?.logo || ''
                    }
                }
            });
        } catch (error) {
            console.error('Internal error:', error.message);
            return res.status(500).json({
                status: false,
                message: 'Internal server error: ' + error.message,
                data: null
            });
        }
    });
};
