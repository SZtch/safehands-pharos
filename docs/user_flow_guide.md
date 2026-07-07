# Alur Pengguna (User Flow) SafeHands Pharos

Untuk membantu Anda (dan Juri Hackathon) memahami bagaimana produk ini digunakan dari awal hingga akhir, berikut adalah visualisasi dan penjelasan lengkap tentang Alur Pengguna (*User Flow*).

## Visualisasi Alur

```mermaid
graph TD
    %% Styling
    classDef userAction fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef systemAction fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef platform fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;
    classDef terminal fill:#1f2937,stroke:#111827,stroke-width:2px,color:#fff;
    
    %% Nodes
    A[🧑 Juri/Pengguna mulai]:::userAction
    B[💻 Install Package]:::terminal
    C[🪄 Jalankan Wizard 'npx safehands-pharos init']:::terminal
    D{Punya Private Key?}:::systemAction
    E[✅ Masukkan Key & URL DODO]:::systemAction
    F[🔑 Auto-Create Wallet AES-256]:::systemAction
    G[📄 File .env Terbuat Otomatis]:::systemAction
    
    H[🌐 Buka Platform Anvita Flow]:::platform
    I[🔌 Tambahkan MCP Server]:::userAction
    J[🤖 Buat Agen AI]:::platform
    K[🛡️ Tarik Skill SafeHands ke Agen]:::userAction
    L[💬 Chat dengan Agen: 'Beli Token X senilai $50']:::userAction
    
    M[⚙️ Agen Menjalankan Preflight Check]:::systemAction
    N{Apakah Aman? GoPlus, Chainlink, Limits}:::systemAction
    O[🛑 Transaksi Diblokir: Laporan Risiko Ditampilkan]:::systemAction
    P[✅ Transaksi Dieksekusi Secara On-Chain]:::systemAction

    %% Edges
    A --> B
    B -->|npm install -g safehands-pharos| C
    C --> D
    D -->|Ya| E
    D -->|Tidak| F
    E --> G
    F --> G
    
    G --> H
    H --> I
    I -->|Import npx safehands-pharos| J
    J --> K
    K --> L
    
    L --> M
    M --> N
    N -->|Bahaya / Pajak Tinggi / Lebihi Limit| O
    N -->|Aman & Sesuai Policy| P
```

## Penjelasan Langkah-demi-Langkah

### Tahap 1: Instalasi & Onboarding (Terminal)
Ini adalah tahap pertama saat juri menguji proyek Anda.
1. Juri menjalankan perintah instalasi di terminal mereka.
2. Juri mengetik `npx safehands-pharos init`.
3. Terminal akan interaktif bertanya kepada juri (seperti sedang mengobrol) untuk mengatur konfigurasi. Jika juri malas memasukkan *Private Key*, sistem otomatis membuatkan dompet terenkripsi (AES-256) untuk mereka. Hasil akhirnya: **File `.env` tercipta dengan rapi tanpa perlu edit manual**.

### Tahap 2: Integrasi ke Platform AI (Anvita Flow)
Setelah terminal siap, juri pindah ke platform visual.
1. Juri membuka **Anvita Flow** (atau Claude Desktop).
2. Di pengaturan MCP, juri menambahkan server baru dengan perintah `npx safehands-pharos`.
3. Secara ajaib, **30 Skill** (Pengecek GoPlus, Harga Chainlink, Eksekusi, x402) akan muncul di layar Anvita Flow sebagai balok-balok fungsional.
4. Juri menarik dan menghubungkan balok-balok skill tersebut ke *Agent Node* mereka.

### Tahap 3: Interaksi & Keamanan (Agent Arena)
Ini adalah puncaknya. Juri sekarang bertindak sebagai *End-User* yang mengobrol dengan Agen AI.
1. Juri mengetik di kolom chat: *"Tolong belikan saya token X senilai $50"*.
2. Agen AI akan memanggil `safehands_preflight_check`.
3. **Di Balik Layar (Backend)**: SafeHands secara otomatis menarik harga dari **Chainlink Oracle**, mengecek kontrak Token X di **GoPlus**, dan memastikan harganya di bawah $50.
4. **Hasil**:
   - Jika Token X adalah *honeypot*, agen akan membalas: *"Maaf, transaksi saya hentikan karena Token X terdeteksi sebagai penipuan oleh GoPlus."*
   - Jika aman, agen akan memanggil `execute_swap`, menandatangani transaksi, dan mencetak *hash* kesuksesan dari Pharos Mainnet.

## Mengapa Alur Ini Sangat Bagus?
Alur ini dirancang agar **Juri tidak perlu menyentuh satu baris kode pun** (Zero-Code Experience). Dari menginstal hingga mengeksekusi transaksi mainnet, semuanya dipandu oleh *Wizard* dan divisualisasikan oleh *Anvita Flow*. Inilah definisi dari produk siap pakai (*Production-Ready*).
