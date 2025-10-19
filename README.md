# 🕵️‍♂️ STEGNOGRAPHY TOOL

A powerful full-stack application that allows users to **embed, extract, and analyze** hidden data inside multimedia files such as **images** and **audio**.  
Built with **React (frontend)** and **Node.js + Express (backend)** for a smooth, secure, and modern experience.

---

## 🚀 Features

- 🔐 **Embed Mode:** Hide secret messages or files inside images/audio securely.  
- 🧩 **Extract Mode:** Retrieve hidden data from previously encoded files.  
- 🧠 **Analyze Mode:** Detect whether a file may contain steganographic content.  
- ⚡ **AES-256 Encryption:** Optional password-based encryption for maximum data protection.  
- 🧹 **Secure File Handling:** No permanent file storage — all uploads are processed in memory.  
- 🖼️ **Supports multiple formats:** PNG, JPEG, WAV, OGG, MP3, FLAC, and ZIP.  
- 💻 **Cross-platform:** Works locally or when deployed on cloud services like Render, Vercel, or Railway.  

---

## 🛠️ Tech Stack

**Frontend:** React + Vite + Tailwind CSS  
**Backend:** Node.js + Express + Sharp + Crypto  
**File Uploads:** Multer (in-memory storage)  
**Security:** AES-256 encryption with optional passwords  

---

## ⚙️ Installation & Setup

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/surojuhomsaisantosh/STEGNOGRAPHY.git
cd STEGNOGRAPHY
2️⃣ Backend Setup
bash
Copy code
cd backend
npm install
node server.js
3️⃣ Frontend Setup
bash
Copy code
cd ../frontend
npm install
npm run dev
🧪 Example Use Cases
Hide confidential messages or files inside everyday images.

Embed secret audio clips for secure transmission.

Analyze files to detect possible data manipulation.

Use as a cybersecurity teaching tool for data hiding and steganalysis concepts.

🔒 Security Notes
Uses AES-256 encryption when password protection is enabled.

Sanitizes user inputs to prevent malicious uploads.

Does not store files permanently on the server.

🧑‍💻 Author
Suroju Hom Sai Santosh
GitHub: @surojuhomsaisantosh
