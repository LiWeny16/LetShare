const sharedMalayTranslation = {
    translation: {
        meta: {
            title: "LetShare | Perkongsian Fail & Teks Merentas Platform"
        },
        welcome: "Selamat datang ke Aplikasi Saya",
        language: "Bahasa",
        button: {
            file: "Fail",
            image: "Gambar",
            text: "Teks",
            clipboard: "Papan Klip",
            searchUsers: "Cari pengguna dalam Wi-Fi yang sama",
            cancel: "Batal",
            confirm: "Sahkan",
            accept: "Terima",
            reject: "Tolak"
        },
        prompt: {
            dropToUpload: "Lepaskan untuk muat naik"
        },
        guide: {
            title: "Panduan Pengguna 🎉:",
            step1: "1. Sambungkan kedua-dua peranti ke Wi-Fi yang <strong>sama</strong>",
            step2: "2. ID bilik mesti <strong>sepadan</strong> di kedua-dua peranti!"
        },
        dialog: {
            newShare: "✨ Kongsi Baru",
            incomingMessage: "Anda menerima mesej, adakah anda mahu terima?",
            inputText: "Masukkan Teks"
        },
        placeholder: {
            inputText: "Sila masukkan teks untuk dihantar..."
        },
        toast: {
            copiedToClipboard: "Berjaya salin ke papan klip",
            zipFailed: "Pemampatan gagal. Sila cuba lagi.",
            connectingUser: "Sedang sambung ke pengguna...",
            taskInProgress: "Tugas sedang dijalankan!",
            clipboardEmpty: "Papan klip kosong atau tidak disokong.",
            noContentSelected: "Tiada kandungan dipilih",
            emptyInput: "Kosong"
        },
        // download
        transfer: {
            sending: "📤 Menghantar fail kepada <strong>{{name}}</strong>",
            receiving: "📥 Menerima fail dari <strong>{{name}}</strong>: {{filename}}",
            byte: "bait",
            receivedFiles: "📁 Fail yang diterima",
            noTasks: "Tiada tugas aktif"
        },
        // settings
        settings: {
            title: "Tetapan",
            languageLabel: "Bahasa",
            languageOptions: {
                system: "Ikut sistem",
                zh: "Cina Ringkas",
            },
            roomId: {
                label: "ID Bilik",
                required: "ID bilik wajib diisi",
                helper: "Peranti mesti menggunakan ID bilik yang sama untuk berhubung"
            },
            saveButton: "Simpan Tetapan",
            joinSuccess: "Berjaya sertai bilik"
        },
        footer: {
            shareTitle: "Kongsi · Segera",
            qrPrompt: "Imbas kod QR untuk menyertai bilik:",
        },
        userId: {
            inputError: "Hanya huruf, nombor",
            display: "ID anda"
        },
        alert: {
            invalidRoom: "Nama bilik tidak sah",
            newUser: "Pengguna baru telah bersambung: {{name}}",
            transferCancelled: "Pihak lawan membatalkan pemindahan!",
            chunkMissing: "Kepingan {{index}} hilang. Sila hantar semula fail!",
            unzipping: "Sedang mengekstrak... sila tunggu",
            fileReceived: "Berjaya menerima fail daripada {{name}}!",
            disconnected: "Terputus sambungan. Sila tunggu atau segarkan semula"
        }
    }
}

export const resources = {
    en: {
        translation: {
            meta: {
                title: "LetShare | Cross-platform File & Text Sharing"
            },
            welcome: "Welcome to My App",
            language: "Language",
            button: {
                file: "File",
                image: "Image",
                text: "Text",
                clipboard: "Clipboard",
                searchUsers: "Search Users in Same Wi-Fi",
                cancel: "Cancel",
                confirm: "Confirm",
                accept: "Accept",
                reject: "Reject",
            },
            prompt: {
                dropToUpload: "Drop to upload"
            },
            guide: {
                title: "User Guide 🎉:",
                step1: "1. Connect both devices to the <strong>same</strong> Wi-Fi",
                step2: "2. Room IDs <strong>must match</strong> on both devices!"
            },
            dialog: {
                newShare: "✨ New Share",
                incomingMessage: "You received a message, accept it?",
                inputText: "Input Text"
            },
            placeholder: {
                inputText: "Please enter the text to send..."
            },
            toast: {
                copiedToClipboard: "Copied to clipboard",
                zipFailed: "File compression failed. Please try again.",
                connectingUser: "Connecting to user, please wait...",
                taskInProgress: "A task is already in progress!",
                clipboardEmpty: "Clipboard is empty or unsupported.",
                noContentSelected: "No content selected",
                emptyInput: "It's empty"
            },
            // Download.tsx
            transfer: {
                sending: "📤 Sending file to <strong>{{name}}</strong>",
                receiving: "📥 Receiving file from <strong>{{name}}</strong>: {{filename}}",
                byte: "byte",
                receivedFiles: "📁 Received Files",
                noTasks: "No active tasks"
            },
            // Settings
            settings: {
                title: "Settings",
                languageLabel: "Language",
                languageOptions: {
                    system: "Follow system",
                    zh: "Simplified Chinese",
                },
                roomId: {
                    label: "Room ID",
                    required: "Room ID is required",
                    helper: "Only Same RoomId Can Connect"
                },
                saveButton: "Save Settings",
                joinSuccess: "Successfully joined room"
            },
            footer: {
                shareTitle: "Share · Instantly",
                qrPrompt: "Scan the QR code to join room:",
            },
            userId: {
                inputError: "Only letters, numbers",
                display: "Your ID"
            },
            alert: {
                invalidRoom: "Invalid room name",
                newUser: "New user connected: {{name}}",
                transferCancelled: "The other party canceled the transfer!",
                chunkMissing: "Chunk {{index}} missing. Please resend the file!",
                unzipping: "Unzipping... please wait",
                fileReceived: "Successfully received file from {{name}}!",
                disconnected: "Disconnected. Please wait or refresh the page"
            }
        }
    },
    zh: {
        translation: {
            meta: {
                title: "乐享Share | 文件 & 文本跨平台共享"
            },
            welcome: "欢迎使用我的应用",
            language: "语言",
            button: {
                file: "文件",
                image: "图片",
                text: "文本",
                clipboard: "剪贴板",
                searchUsers: "搜索同WIFI下用户",
                cancel: "取消",
                confirm: "确认",
                accept: "接受",
                reject: "拒绝"
            },
            prompt: {
                dropToUpload: "松手上传文件"
            },
            guide: {
                title: "使用指南🎉：",
                step1: "1. 两个设备连接到<strong>同一个</strong>局域网（部分公共 WiFi 不可用）",
                step2: "2. 两个设备房间号<strong>必须相同</strong>！"
            },
            dialog: {
                newShare: "✨ 新分享",
                incomingMessage: "您有来自外部的消息，是否接受？",
                inputText: "输入文本"
            },
            placeholder: {
                inputText: "请输入要发送的文本..."
            },
            toast: {
                copiedToClipboard: "成功写入剪贴板",
                zipFailed: "文件压缩失败，请重试！",
                connectingUser: "正在连接目标用户，请等待连接建立",
                taskInProgress: "有任务正在进行中！",
                clipboardEmpty: "剪切板为空, 或浏览器不支持",
                noContentSelected: "未选择发送内容",
                emptyInput: "空啦"
            },
            // Download
            transfer: {
                sending: "📤 正在发送文件给 <strong>{{name}}</strong>",
                receiving: "📥 正在接收来自 <strong>{{name}}</strong> 的文件：{{filename}}",
                byte: "字节",
                receivedFiles: "📁 已接收的文件",
                noTasks: "没有进行中的任务"
            },
            // Settings
            settings: {
                title: "设置",
                languageLabel: "语言/Language",
                languageOptions: {
                    system: "跟随系统",
                    zh: "简体中文",

                },
                roomId: {
                    label: "房间号",
                    required: "房间号必填啦",
                    helper: "只有同一房间号才能互相连接哦"
                },
                saveButton: "保存设置",
                joinSuccess: "成功加入房间"
            },
            footer: {
                shareTitle: "分享·一触即发",
                qrPrompt: "扫描二维码以加入房间:",
            },
            userId: {
                inputError: "只允许12字符以内的字母、数字和汉字",
                display: "你的ID"
            },
            alert: {
                invalidRoom: "房间名不合法",
                newUser: "新用户已连接: {{name}}",
                transferCancelled: "对方取消了传输！",
                chunkMissing: "文件传输缺少切片 {{index}}，请重新传输！",
                unzipping: "解压中，请耐心等待...",
                fileReceived: "成功接受来自 {{name}} 的文件！",
                disconnected: "与对方断开连接，请等待或刷新页面"
            }

        }
    },
    ms: sharedMalayTranslation,
    id: sharedMalayTranslation
};
