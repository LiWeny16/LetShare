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
            disconnected: "Server telah terputus",
            cancel: "Batal",
            confirm: "Sahkan",
            accept: "Terima",
            reject: "Tolak",
            downloadAll: "Download All",
        },
        prompt: {
            dropToUpload: "Lepaskan untuk muat naik"
        },
        guide: {
            title: "Panduan Pengguna:",
            step1: "1. Sambungkan kedua-dua peranti ke Wi-Fi yang <strong>sama</strong>",
            step2: "2. ID bilik mesti <strong>sepadan</strong> di kedua-dua peranti!"
        },
        dialog: {
            newShare: "Kongsi Baru",
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
            emptyInput: "Kosong",
            waitingForAccept: "Menunggu penerimaan...",
            receivingFile: "Menerima fail melalui pelayan...",
            transferRejected: "Pemindahan ditolak",
            fileTransferFailed: "Pemindahan fail gagal, sila cuba lagi",
            fileSent: "Fail berjaya dihantar!",
            transferCancelled: "Pemindahan dibatalkan",
            transferError: "Ralat pemindahan fail",
            fileAssemblyError: "Pemasangan fail gagal, sila cuba lagi",
            fileReceived: "Berjaya menerima fail!",
            serverTransferNotAvailable: "Pemindahan pelayan tidak tersedia",
            notInRoom: "Tidak dalam bilik",
            clipboardReadUnsupported: "Persekitaran tidak menyokong pembacaan papan klip",
            clipboardReadFailed: "Gagal membaca papan klip, sila semak kebenaran atau tampal secara manual.",
            clipboardWriteUnsupported: "Persekitaran tidak menyokong penulisan papan klip",
            clipboardWriteFailed: "Penyalinan gagal, sila salin teks secara manual.",
            serverTransferMode: "Ditukar ke mod pemindahan pelayan"
        },
        // download
        transfer: {
            sending: "Menghantar fail kepada <strong>{{name}}</strong>",
            receiving: "Menerima fail dari <strong>{{name}}</strong>: {{filename}}",
            byte: "bait",
            receivedFiles: "Fail yang diterima",
            sentFiles: "Fail yang dihantar",
            awaitingConfirmation: "Menunggu penerima mengesahkan selesai...",
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
            joinSuccess: "Berjaya sertai bilik",
            advanced: {
                title: "Tetapan Lanjutan",
                                    serverMode: {
                        label: "Mod Pelayan",
                        auto: "Automatik",
                        global: "Global",
                        china: "China",
                        switchSuccess: "Berjaya beralih ke pelayan {{mode}}",
                        switchError: "Gagal beralih ke pelayan {{mode}}",
                        switchErrorDetail: "Pertukaran mod pelayan gagal: {{detail}}"
                    },
                customServerUrl: {
                    label: "URL Pelayan Tersuai",
                    helper: "Hanya tersedia dalam mod tersuai",
                    disabled: "Hanya tersedia dalam mod tersuai"
                },
                authToken: {
                    label: "Token Pengesahan",
                    helper: "Hanya tersedia dalam mod tersuai",
                    disabled: "Hanya tersedia dalam mod tersuai"
                },
                ablyKey: {
                    label: "Kunci Ably",
                    helper: "Hanya tersedia dalam mod global",
                    disabled: "Hanya tersedia dalam mod global"
                },
                resetAll: "Set Semula Semua Tetapan",
                resetConfirm: "Adakah anda pasti mahu menetapkan semula semua tetapan? Ini akan memadamkan semua konfigurasi dan memuat semula halaman."
            },
            transferPriority: {
                label: "Keutamaan Pemindahan",
                p2p: "P2P Dahulu",
                server: "Rangkaian Awam Dahulu",
                helper: "P2P lebih pantas tetapi memerlukan kedua-dua peranti boleh dihubungi. Geganti rangkaian awam lebih stabil tetapi lebih perlahan."
            }
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
            disconnected: "Terputus sambungan. Sila tunggu atau segarkan semula",
            proxy: "IP virtual telah terdeteksi, mohon jangan gunakan proxy atau VPN, jika tidak, Anda mungkin tidak dapat terhubung!",
            p2pDisconnected: "Sambungan P2P dengan {{name}} terputus, menggunakan rangkaian awam",
            p2pTimeout: "Sambungan P2P dengan {{name}} tamat masa, menggunakan rangkaian awam",
            p2pFailed: "Sambungan P2P dengan {{name}} gagal, menggunakan rangkaian awam",
            serverConnectionFailed: "Semua pelayan isyarat gagal disambungkan!",
            roomSwitchFailed: "Gagal menukar bilik: {{error}}",
            fileSendP2PRequired: "Penghantaran fail memerlukan sambungan P2P, pengguna semasa hanya menyokong mod teks",
            p2pOnlyOverseas: "Pemindahan fail memerlukan sambungan rakan-ke-rakan terus. Kedua-dua pengguna mesti dalam talian.",
            transferRequestTimeout: "Penerima tidak membalas permintaan pemindahan, sila cuba lagi",
            serverTransferNotAvailable: "Pemindahan fail pelayan tidak tersedia",
            notInRoom: "Tidak dalam bilik",
            transferInterrupted: "Pemindahan pelayan terganggu, tugas semasa dihentikan, sila cuba lagi",
            p2pTransferInterrupted: "Pemindahan P2P terganggu, tugas semasa dihentikan, sila klik pengguna untuk cuba lagi",
            p2pDisconnectedTransfer: "Sambungan P2P terputus, pemindahan fail semasa dihentikan, sila cuba lagi",
            p2pErrorTransfer: "Sambungan P2P ralat, pemindahan fail semasa dihentikan, sila cuba lagi",
            p2pBackgroundTimeout: "Halaman di latar terlalu lama, pemindahan P2P dihentikan, sila kembali ke depan untuk cuba lagi",
            resendRecoveryFailed: "Pemulihan penghantaran semula gagal, tugas semasa dihentikan, sila cuba lagi",
            resendSenderDisconnected: "Penghantar tidak dapat menghantar semula cebisan hilang, sila mulakan semula pemindahan",
            resendFailed: "Penghantaran semula cebisan hilang gagal, sila mulakan semula pemindahan",
            serverResendFailed: "Penghantaran semula cebisan pelayan gagal, sila cuba lagi",
            alreadyReceiving: "Fail sedang diterima, sila tunggu sehingga selesai",
            metadataInvalid: "Metadata pemindahan fail tidak sah, sila cuba lagi: {{detail}}",
            malformedMessage: "Menerima mesej kawalan tidak sah, pemindahan dihentikan, sila cuba lagi: {{detail}}",
            malformedServerMessage: "Menerima mesej pelayan tidak normal, pemindahan dihentikan, sila cuba lagi: {{detail}}",
            malformedMessageIgnored: "Menerima mesej pelayan tidak normal, diabaikan: {{detail}}",
            fileTooLarge: "Had saiz fail ialah 3GB setiap fail. Sila pastikan ruang cakera mencukupi",
            cacheLimitExceeded: "Pelayar telah menyimpan {{totalFiles}} fail / {{totalMB}}MB. Had simpanan selamat peranti semasa ialah {{maxFiles}} / {{maxMB}}MB, sila muat turun dan kosongkan fail diterima dahulu.",
            passwordRequired: "Keahlian PRO diperlukan untuk memindahkan fail melebihi 50MB. Naik taraf dalam Tetapan",
            capabilityNotSupported: "Sambungan semasa tidak menyokong pemindahan fail pelayan, sila tukar pelayan atau cuba P2P",
            serverCapabilityNotSupported: "Sambungan pelayan semasa tidak menyokong pemindahan fail, sila tukar ke pelayan tersuai atau tunggu P2P",
            serverNotConnected: "Sambungan pelayan tidak tersedia, tidak dapat memindahkan fail, sila sambung semula",
            sendRequestFailed: "Permintaan pemindahan pelayan gagal dihantar, sila sambung semula",
            acceptSendFailed: "Pengesahan pemindahan pelayan gagal dihantar, sila cuba lagi",
            chunkOutOfBounds: "Menerima cebisan fail di luar had, sila cuba lagi",
            chunkCorrupted: "Menerima cebisan fail rosak, sila cuba lagi",
            chunkMissingMetadata: "Menerima cebisan tanpa metadata, sila cuba lagi",
            chunkInvalid: "Menerima cebisan fail tidak sah, sila cuba lagi",
            bufferNotAvailable: "Penimbal penerimaan tidak tersedia, sila cuba lagi",
            transferRequestFailed: "Permintaan pemindahan fail gagal, sila cuba lagi",
            insufficientMemory: "Storan peranti tidak mencukupi untuk menerima fail ini",
            fileAssemblyFailed: "Pemasangan fail gagal, sila cuba lagi",
            readTimeout: "Membaca cebisan fail tamat masa, sila cuba lagi",
            unexpectedChunk: "Menerima cebisan bukan milik tugas semasa, pemindahan dihentikan, sila cuba lagi",
            unrecognizedChunk: "Menerima cebisan tidak dikenal pasti, pemindahan semasa dihentikan, sila cuba lagi",
            chunkWithoutTransfer: "Menerima cebisan tetapi sesi penerimaan tidak wujud, pemindahan dihentikan, sila cuba lagi",
            chunkMissingFileMeta: "Menerima cebisan tetapi tiada metadata fail, pemindahan dihentikan, sila cuba lagi",
            unexpectedBinary: "Menerima data binari tidak dikenal pasti, pemindahan dihentikan, sila cuba lagi",
            zipTooLarge: "Fail ZIP agak besar, dikekalkan sebagai ZIP untuk kurangkan penggunaan memori",
            zipTooManyFiles: "Bilangan fail agak banyak, dikekalkan sebagai ZIP untuk kurangkan penggunaan memori",
            receiverNoAck: "Penerima tidak mengesahkan penyelesaian, tugas semasa dihentikan, sila cuba lagi",
            senderCanceled: "Penghantar membatalkan pemindahan",
            userCancelReceive: "Pengguna membatalkan penerimaan",
            serverRejectTimeout: "Penerima tidak membalas permintaan pemindahan, sila cuba lagi",
            unknownReason: "Sebab tidak diketahui",
            serverSendingFile: "Menghantar fail melalui pelayan",
            serverTransferComplete: "Pemindahan pelayan selesai",
            p2pSendingFile: "Menghantar fail melalui P2P",
            p2pTransferComplete: "Pemindahan P2P selesai",
            receivingFile: "Menerima fail",
            fileReceivedComplete: "Fail diterima selesai",
            resendRequesting: "Penerima meminta penghantaran semula {{count}}/{{missing}} cebisan, sedang pulih",
            serverResendRequesting: "Penerima meminta penghantaran semula {{count}}/{{missing}} cebisan pelayan, sedang pulih",
            resendRequestingTimeout: "Penerimaan lama tanpa kemajuan, meminta penghantaran semula cebisan ({{attempt}}/{{max}})",
            serverResendRequestingTimeout: "Penerimaan pelayan lama tanpa kemajuan, meminta penghantaran semula cebisan ({{attempt}}/{{max}})",
            resendTimeoutReason: "Penerimaan lama tanpa kemajuan, sila hantar semula cebisan hilang",
            serverResendTimeoutReason: "Penerimaan pelayan lama tanpa kemajuan, sila hantar semula cebisan hilang",
            resendRecoveryImpossible: "Pemulihan automatik tidak dapat dilakukan, sila hantar semula",
            senderTransferInterrupted: "Penghantar mengesan gangguan pemindahan, sila cuba lagi",
            serverConnectionLost: "Sambungan pelayan terputus",
            autoAcceptFile: "{{user}} sedang menghantar fail: {{filename}} ({{size}} MB)"
        },
        status: {
            textOnly: "Teks Sahaja",
            publicNetwork: "Internet",
            publicNetworkTooltip: "Disambungkan melalui rangkaian awam. Teks boleh dihantar; sambungan P2P terus belum tersedia.",
            p2pTooltip: "Sambungan P2P terus tersedia untuk pemindahan pantas.",
            connectingTooltip: "Sedang mencuba sambungan P2P terus.",
            connecting: "Menyambung",
            connected: "Bersambung",
            disconnected: "Terputus"
        },
        background: {
            timeout: "Halaman latar belakang melebihi {{seconds}} saat, memutuskan sambungan pelayan untuk penjimatan"
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
                disconnected: "The server has been disconnected",
                cancel: "Cancel",
                confirm: "Confirm",
                accept: "Accept",
                reject: "Reject",
                downloadAll: "Download All",
            },
            prompt: {
                dropToUpload: "Drop to upload"
            },
            guide: {
                title: "User Guide:",
                step1: "1. Connect both devices to the <strong>same</strong> Wi-Fi",
                step2: "2. Room IDs <strong>must match</strong> on both devices!"
            },
            dialog: {
                newShare: "New Share",
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
                emptyInput: "It's empty",
                waitingForAccept: "Waiting for acceptance...",
                receivingFile: "Receiving file via server...",
                transferRejected: "Transfer rejected",
                fileTransferFailed: "File transfer failed, please try again",
                fileSent: "File sent successfully!",
                transferCancelled: "Transfer cancelled",
                transferError: "File transfer error",
                fileAssemblyError: "File assembly failed, please try again",
                fileReceived: "File received successfully!",
                serverTransferNotAvailable: "Server transfer not available",
                notInRoom: "Not in room",
                clipboardReadUnsupported: "Clipboard read not supported in this environment",
                clipboardReadFailed: "Failed to read clipboard, please check permissions or paste manually.",
                clipboardWriteUnsupported: "Clipboard write not supported in this environment",
                clipboardWriteFailed: "Copy failed, please copy text manually.",
                serverTransferMode: "Switched to server relay mode"
            },
            // Download.tsx
            transfer: {
                sending: "Sending file to <strong>{{name}}</strong>",
                receiving: "Receiving file from <strong>{{name}}</strong>: {{filename}}",
                byte: "byte",
                receivedFiles: "Received Files",
                sentFiles: "Sent Files",
                awaitingConfirmation: "Waiting for receiver confirmation...",
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
                joinSuccess: "Successfully joined room",
                advanced: {
                    title: "Advanced Settings",
                    serverMode: {
                        label: "Server Mode",
                        auto: "Auto",
                        global: "Global",
                        china: "China",
                        switchSuccess: "Successfully switched to {{mode}} server",
                        switchError: "Failed to switch to {{mode}} server",
                        switchErrorDetail: "Server mode switch failed: {{detail}}"
                    },
                    customServerUrl: {
                        label: "Custom Server URL",
                        helper: "Only available in custom mode",
                        disabled: "Only available in custom mode"
                    },
                    authToken: {
                        label: "Auth Token",
                        helper: "Only available in custom mode",
                        disabled: "Only available in custom mode"
                    },
                    ablyKey: {
                        label: "Ably Key",
                        helper: "Only available in global mode",
                        disabled: "Only available in global mode"
                    },
                    resetAll: "Reset All Settings",
                    resetConfirm: "Are you sure you want to reset all settings? This will clear all configurations and refresh the page."
                },
                transferPriority: {
                    label: "Transfer Priority",
                    p2p: "P2P First",
                    server: "Public Network First",
                    helper: "P2P is faster but requires both devices to be reachable. Public network relay is more reliable but slower."
                }
            },
            footer: {
                shareTitle: "Share · Instantly",
                qrPrompt: "Scan the QR code to join room:",
            },
            chat: {
                noMessages: "No chat messages yet",
                inputPlaceholder: "Type a message...",
                deleteHistory: "Delete chat history",
                sendFile: "Send file"
            },
            userId: {
                inputError: "Only letters, numbers",
                display: "Your ID"
            },
            alert: {
                invalidRoom: "Invalid room name",
                newUser: "New user connected: {{name}}",
                transferCancelled: "The other party cancelled the transfer!",
                chunkMissing: "File chunk {{index}} missing. Please resend the file!",
                unzipping: "Extracting... please wait",
                fileReceived: "Successfully received file from {{name}}!",
                disconnected: "Disconnected. Please wait or refresh the page",
                proxy: "Virtual IP detected, please don't use proxy or VPN, otherwise you may not be able to connect!",
                p2pDisconnected: "P2P connection with {{name}} disconnected, using public network channel",
                p2pTimeout: "P2P connection with {{name}} timed out, using public network channel",
                p2pFailed: "P2P connection with {{name}} failed, using public network channel",
                serverConnectionFailed: "All signaling servers failed to connect!",
                roomSwitchFailed: "Failed to switch room: {{error}}",
                fileSendP2PRequired: "File sending requires P2P connection, current user only supports text mode",
                p2pOnlyOverseas: "File transfer requires direct peer-to-peer connection on this network. Both users must be online.",
                transferRequestTimeout: "Receiver did not respond to transfer request, please try again",
                serverTransferNotAvailable: "Server file transfer not available",
                notInRoom: "Not in room",
                transferInterrupted: "Server transfer interrupted, current task stopped, please try again",
                p2pTransferInterrupted: "P2P transfer interrupted, current task stopped, please click user to retry",
                p2pDisconnectedTransfer: "P2P connection disconnected, file transfer stopped, please try again",
                p2pErrorTransfer: "P2P connection error, file transfer stopped, please try again",
                p2pBackgroundTimeout: "Page in background too long, P2P transfer stopped, please return to foreground to retry",
                resendRecoveryFailed: "Chunk resend recovery failed, current task stopped, please try again",
                resendSenderDisconnected: "Sender can no longer resend missing chunks, please restart the transfer",
                resendFailed: "Missing chunk resend failed, please restart the transfer",
                serverResendFailed: "Server chunk resend failed, please try again",
                alreadyReceiving: "Already receiving a file, please wait for completion",
                metadataInvalid: "File transfer metadata invalid, please try again: {{detail}}",
                malformedMessage: "Received unrecognized control message, transfer stopped, please try again: {{detail}}",
                malformedServerMessage: "Received abnormal server message, transfer stopped, please try again: {{detail}}",
                malformedMessageIgnored: "Received abnormal server message, ignored: {{detail}}",
                fileTooLarge: "File size limit is 3GB per file. Please ensure sufficient disk space",
                cacheLimitExceeded: "Browser has cached {{totalFiles}} files / {{totalMB}}MB. Device safe cache limit is {{maxFiles}} / {{maxMB}}MB, please download and clear received files first.",
                passwordRequired: "PRO membership required to transfer files over 50MB. Upgrade in Settings",
                capabilityNotSupported: "Current connection does not support server file transfer, please switch server or try P2P",
                serverCapabilityNotSupported: "Current server connection does not support file relay, please switch to custom server or wait for P2P",
                serverNotConnected: "Server connection unavailable, cannot relay files, please reconnect",
                sendRequestFailed: "Server transfer request failed to send, please reconnect",
                acceptSendFailed: "Server transfer confirmation failed to send, please try again",
                chunkOutOfBounds: "Received out-of-bounds file chunk, please try again",
                chunkCorrupted: "Received corrupted file chunk, please try again",
                chunkMissingMetadata: "Received chunk without metadata, please try again",
                chunkInvalid: "Received invalid file chunk, please try again",
                bufferNotAvailable: "Receive buffer not available, please try again",
                transferRequestFailed: "File transfer request failed, please try again",
                insufficientMemory: "Insufficient device storage to receive this file",
                fileAssemblyFailed: "File assembly failed, please try again",
                readTimeout: "Reading file chunk timed out, please try again",
                unexpectedChunk: "Received chunk not belonging to current task, transfer stopped, please try again",
                unrecognizedChunk: "Received unrecognized file chunk, current transfer stopped, please try again",
                chunkWithoutTransfer: "Received file chunk but no receive session exists, transfer stopped, please try again",
                chunkMissingFileMeta: "Received file chunk but missing file metadata, transfer stopped, please try again",
                unexpectedBinary: "Received unrecognized binary data, transfer stopped, please try again",
                zipTooLarge: "ZIP file is large, kept as ZIP to reduce memory usage",
                zipTooManyFiles: "Many files in archive, kept as ZIP to reduce memory usage",
                receiverNoAck: "Receiver did not confirm completion, current task stopped, please try again",
                senderCanceled: "Sender cancelled the transfer",
                userCancelReceive: "User cancelled receiving",
                serverRejectTimeout: "Receiver did not respond to transfer request, please try again",
                unknownReason: "Unknown reason",
                serverSendingFile: "Sending file via server",
                serverTransferComplete: "Server transfer complete",
                p2pSendingFile: "Sending file via P2P",
                p2pTransferComplete: "P2P transfer complete",
                receivingFile: "Receiving file",
                fileReceivedComplete: "File received complete",
                resendRequesting: "Receiver requested resend of {{count}}/{{missing}} chunks, recovering",
                serverResendRequesting: "Receiver requested resend of {{count}}/{{missing}} server chunks, recovering",
                resendRequestingTimeout: "Receive stalled, requesting missing chunks ({{attempt}}/{{max}})",
                serverResendRequestingTimeout: "Server receive stalled, requesting missing chunks ({{attempt}}/{{max}})",
                resendTimeoutReason: "Receive stalled, please resend missing chunks",
                serverResendTimeoutReason: "Server receive stalled, please resend missing chunks",
                resendRecoveryImpossible: "Automatic resend recovery not possible, please resend",
                senderTransferInterrupted: "Sender detected transfer interruption, please try again",
                serverConnectionLost: "Server connection lost",
                autoAcceptFile: "{{user}} is sending file: {{filename}} ({{size}} MB)"
            },
            status: {
                textOnly: "Text Only",
                publicNetwork: "Internet",
                publicNetworkTooltip: "Connected through the public network channel. Text can be sent; direct P2P is not established.",
                p2pTooltip: "Direct P2P connection is available for faster transfer.",
                connectingTooltip: "Trying to establish a direct P2P connection.",
                connecting: "Connecting",
                connected: "Connected", 
                disconnected: "Disconnected"
            },
            background: {
                timeout: "Background page exceeded {{seconds}} seconds, disconnecting server for saving"
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
                disconnected: "服务器已断开连接",
                cancel: "取消",
                confirm: "确认",
                accept: "接受",
                reject: "拒绝",
                downloadAll: "全部下载",
            },
            prompt: {
                dropToUpload: "松手上传文件"
            },
            guide: {
                title: "使用指南：",
                step1: "1. 两个设备连接到<strong>同一个</strong>局域网（部分公共 WiFi 不可用）",
                step2: "2. 两个设备房间号<strong>必须相同</strong>！"
            },
            dialog: {
                newShare: "新分享",
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
                emptyInput: "空啦",
                waitingForAccept: "等待对方接受...",
                receivingFile: "正在通过服务器接收文件...",
                transferRejected: "传输被拒绝",
                fileTransferFailed: "文件传输失败，请重试",
                fileSent: "文件发送成功！",
                transferCancelled: "传输已取消",
                transferError: "文件传输错误",
                fileAssemblyError: "文件组装失败，请重试",
                fileReceived: "文件接收成功！",
                serverTransferNotAvailable: "服务器传输不可用",
                notInRoom: "未加入房间",
                clipboardReadUnsupported: "当前环境不支持读取剪贴板",
                clipboardReadFailed: "读取剪贴板内容失败，请检查权限或手动粘贴。",
                clipboardWriteUnsupported: "当前环境不支持复制到剪贴板",
                clipboardWriteFailed: "复制失败，请手动复制文本。",
                serverTransferMode: "已切换到服务器中转模式"
            },
            // Download
            transfer: {
                sending: "正在发送文件给 <strong>{{name}}</strong>",
                receiving: "正在接收来自 <strong>{{name}}</strong> 的文件：{{filename}}",
                byte: "字节",
                receivedFiles: "已接收的文件",
                sentFiles: "已发送的文件",
                awaitingConfirmation: "等待接收方确认完成...",
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
                joinSuccess: "成功加入房间",
                advanced: {
                    title: "高级设置",
                    serverMode: {
                        label: "服务器模式",
                        auto: "自动",
                        global: "海外",
                        china: "中国",
                        switchSuccess: "成功切换到{{mode}}服务器",
                        switchError: "切换到{{mode}}服务器失败",
                        switchErrorDetail: "服务器模式切换失败: {{detail}}"
                    },
                    customServerUrl: {
                        label: "自定义服务器URL",
                        helper: "仅在自定义模式下可用",
                        disabled: "仅在自定义模式下可用"
                    },
                    authToken: {
                        label: "认证令牌 (Auth Token)",
                        helper: "仅在自定义模式下可用",
                        disabled: "仅在自定义模式下可用"
                    },
                    ablyKey: {
                        label: "Ably 密钥",
                        helper: "仅在海外模式下可用",
                        disabled: "仅在海外模式下可用"
                    },
                    resetAll: "重置所有设置",
                    resetConfirm: "确定要重置所有设置吗？这将清除所有配置并刷新页面。"
                },
                transferPriority: {
                    label: "传输优先级",
                    p2p: "优先 P2P",
                    server: "优先公网传输",
                    helper: "P2P 速度更快但要求双方设备可直连。公网中继更稳定但速度较慢。"
                }
            },
            footer: {
                shareTitle: "分享·一触即发",
                qrPrompt: "扫描二维码以加入房间:",
            },
            chat: {
                noMessages: "暂无聊天记录",
                inputPlaceholder: "输入消息...",
                deleteHistory: "删除聊天记录",
                sendFile: "发送文件"
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
                disconnected: "与对方断开连接，请等待或刷新页面",
                proxy: "检测到虚拟IP，请不要使用代理或VPN，否则可能无法连接！",
                p2pDisconnected: "与 {{name}} 的 P2P 连接断开，已使用公网通道",
                p2pTimeout: "与 {{name}} 的 P2P 连接超时，已使用公网通道",
                p2pFailed: "与 {{name}} 的 P2P 连接失败，已使用公网通道",
                serverConnectionFailed: "所有信令服务器连接失败！",
                roomSwitchFailed: "切换房间失败: {{error}}",
                fileSendP2PRequired: "文件发送需要P2P连接，当前用户仅支持文本模式",
                p2pOnlyOverseas: "当前网络为海外线路，大文件仅支持点对点直连，需双方同时在线",
                transferRequestTimeout: "对方未响应文件传输请求，请重试",
                serverTransferNotAvailable: "服务器文件传输未初始化",
                notInRoom: "未加入房间",
                transferInterrupted: "公网传输中断，已停止当前任务，请重试",
                p2pTransferInterrupted: "P2P 传输中断，已停止当前任务，请点击用户重试",
                p2pDisconnectedTransfer: "P2P 连接已断开，当前文件传输已停止，请重试",
                p2pErrorTransfer: "P2P 连接异常，当前文件传输已停止，请重试",
                p2pBackgroundTimeout: "页面在后台停留较久，P2P 文件传输已停止，请回到前台后重试",
                resendRecoveryFailed: "缺失分片重传失败，已停止当前任务，请重试",
                resendSenderDisconnected: "发送端已无法重传缺失分片，请重新发起传输",
                resendFailed: "重传缺失分片失败，请重新发起传输",
                serverResendFailed: "公网缺失分片重传失败，请重试",
                alreadyReceiving: "已有文件正在接收，请等待完成后重试",
                metadataInvalid: "文件传输元数据无效，请重试：{{detail}}",
                malformedMessage: "收到无法识别的控制消息，当前文件传输已停止，请重试：{{detail}}",
                malformedServerMessage: "收到异常公网传输消息，当前文件传输已停止，请重试：{{detail}}",
                malformedMessageIgnored: "收到异常公网传输消息，已忽略：{{detail}}",
                fileTooLarge: "当前设备单文件接收上限为 3GB，请确保有足够磁盘空间",
                cacheLimitExceeded: "当前浏览器已缓存 {{totalFiles}} 个文件 / {{totalMB}}MB。为避免内存崩溃，当前设备安全缓存上限为 {{maxFiles}} 个 / {{maxMB}}MB，请先下载并清空已接收文件后重试。",
                passwordRequired: "需要 PRO 会员才能传输超过 50MB 的文件，请在设置中升级",
                capabilityNotSupported: "当前线路不支持公网文件中转，请切换服务器或重试 P2P",
                serverCapabilityNotSupported: "当前公网连接不支持文件中转，请切换到自定义服务器或等待 P2P 重连后重试",
                serverNotConnected: "公网连接不可用，无法中转文件，请重连后重试",
                sendRequestFailed: "公网传输请求发送失败，请重连后重试",
                acceptSendFailed: "公网传输确认发送失败，请重试",
                chunkOutOfBounds: "收到越界的文件分片，请重试",
                chunkCorrupted: "收到损坏的文件分片，请重试",
                chunkMissingMetadata: "收到缺少元数据的文件分片，请重试",
                chunkInvalid: "收到无效的文件分片，请重试",
                bufferNotAvailable: "接收缓冲区不可用，请重试",
                transferRequestFailed: "文件传输请求发送失败，请重试",
                insufficientMemory: "设备存储空间不足，无法接收该文件",
                fileAssemblyFailed: "文件组装失败，请重试",
                readTimeout: "读取文件分片超时，请重试",
                unexpectedChunk: "收到不属于当前任务的文件分片，已停止当前任务，请重试",
                unrecognizedChunk: "收到无法识别的文件分片，当前传输已停止，请重试",
                chunkWithoutTransfer: "收到文件分片但接收会话不存在，当前传输已停止，请重试",
                chunkMissingFileMeta: "收到文件分片但缺少文件元数据，当前传输已停止，请重试",
                unexpectedBinary: "收到无法识别的二进制数据，当前传输已停止，请重试",
                zipTooLarge: "压缩包较大，已保留为 ZIP 以降低内存占用",
                zipTooManyFiles: "文件数量较多，已保留为 ZIP 以降低内存占用",
                receiverNoAck: "接收方未确认完成，已停止当前任务，请重试",
                senderCanceled: "发送方取消了传输",
                userCancelReceive: "用户取消接收",
                serverRejectTimeout: "对方未响应文件传输请求，请重试",
                unknownReason: "未知原因",
                serverSendingFile: "正在通过公网发送文件",
                serverTransferComplete: "公网传输完成",
                p2pSendingFile: "正在通过 P2P 发送文件",
                p2pTransferComplete: "P2P 传输完成",
                receivingFile: "正在接收文件",
                fileReceivedComplete: "文件接收完成",
                resendRequesting: "接收方请求重传 {{count}}/{{missing}} 个分片，正在恢复",
                serverResendRequesting: "接收方请求重传 {{count}}/{{missing}} 个公网分片，正在恢复",
                resendRequestingTimeout: "接收长时间无进度，正在请求重传缺失分片（{{attempt}}/{{max}}）",
                serverResendRequestingTimeout: "公网接收长时间无进度，正在请求重传缺失分片（{{attempt}}/{{max}}）",
                resendTimeoutReason: "接收长时间无进度，请重传缺失分片",
                serverResendTimeoutReason: "公网接收长时间无进度，请重传缺失分片",
                resendRecoveryImpossible: "缺失分片自动重传无法恢复，请重新发送",
                senderTransferInterrupted: "发送端检测到传输中断，请重试",
                serverConnectionLost: "服务器连接已断开",
                autoAcceptFile: "{{user}} 正在发送文件: {{filename}} ({{size}} MB)"
            },
            status: {
                textOnly: "仅文本",
                publicNetwork: "公网",
                publicNetworkTooltip: "已通过公网通道连接，可发送文本；P2P 直连尚未建立。",
                p2pTooltip: "已建立 P2P 直连，可用于更快传输。",
                connectingTooltip: "正在尝试建立 P2P 直连。",
                connecting: "连接中",
                connected: "已连接",
                disconnected: "已断开"
            },
            background: {
                timeout: "后台页面超过 {{seconds}} 秒，断开服务器以节省资源"
            }

        }
    },
    ms: sharedMalayTranslation,
    id: {
        ...sharedMalayTranslation,
        translation: {
            ...sharedMalayTranslation.translation,
            alert: {
                ...sharedMalayTranslation.translation.alert,
                p2pOnlyOverseas: "Transfer file memerlukan koneksi peer-to-peer langsung. Kedua pengguna harus online.",
                passwordRequired: "Keanggotaan PRO diperlukan untuk mentransfer file di atas 50MB. Upgrade di Pengaturan",
                fileTooLarge: "Batas ukuran file adalah 3GB per file. Pastikan ruang disk mencukupi",
                insufficientMemory: "Penyimpanan perangkat tidak cukup untuk menerima file ini"
            },
            toast: {
                ...sharedMalayTranslation.translation.toast,
                serverTransferMode: "Beralih ke mode transfer server"
            }
        }
    }
};
