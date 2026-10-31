import { landingMalayTranslations } from "./landingMalayTranslations";

type ThemeKey = "light" | "dark" | "blue" | "green" | "sunset" | "coolGray";
type ModeKey = "direct" | "internet" | "clipboard";

type LandingCopy = {
  nav: string; openAppLabel: string; sections: string; why: string; flow: string; security: string; themeSelector: string; useTheme: (theme: string) => string; language: string; openApp: string;
  themes: Record<ThemeKey, string>;
  kicker: string; hero: string; actions: string; openSharing: string; github: string; highlights: string;
  metrics: Array<{ title: string; copy: string }>;
  preview: string; desktopAlt: string; mobileAlt: string; transferReady: string; transferMeta: string; p2pFirst: string; roomReady: string; devicesOnline: string;
  factsLabel: string; facts: string[]; whyKicker: string; whyTitle: string; whyCopy: string;
  benefits: Array<{ eyebrow: string; title: string; copy: string }>;
  flowKicker: string; flowTitle: string; steps: string[];
  connectionKicker: string; connectionTitle: string; connectionCopy: string; modesLabel: string;
  modes: Record<ModeKey, { label: string; title: string; copy: string; metric: string }>;
  laptop: string; phone: string; showcaseKicker: string; showcaseTitle: string; showcaseCopy: string; showcaseAlt: string;
  faqTitle: string; faqs: Array<{ question: string; answer: string }>;
};

export const landingTranslations: Record<"zh" | "en" | "id" | "ms", LandingCopy> = {
  ms: landingMalayTranslations,
  id: {
    nav: "Navigasi situs LetShare", openAppLabel: "Buka aplikasi LetShare", sections: "Bagian halaman", why: "Keunggulan", flow: "Cara pakai", security: "Koneksi", themeSelector: "Pilih tema", useTheme: (theme) => `Gunakan tema ${theme}`, language: "Bahasa", openApp: "Buka aplikasi",
    themes: { light: "Terang", dark: "Gelap", blue: "Biru", green: "Hijau", sunset: "Senja", coolGray: "Abu-abu" },
    kicker: "Berbagi langsung di browser", hero: "Bagikan file, gambar, teks, dan isi papan klip dengan cepat antarperangkat. Tanpa masuk atau instalasi, dengan status koneksi yang jelas.", actions: "Tindakan utama", openSharing: "Buka aplikasi berbagi", github: "Lihat GitHub", highlights: "Keunggulan LetShare",
    metrics: [{ title: "Tanpa akun", copy: "Mulai di browser" }, { title: "Utamakan P2P", copy: "Langsung jika tersedia" }, { title: "Status jelas", copy: "Jalur publik ditampilkan" }],
    preview: "Pratinjau produk LetShare", desktopAlt: "Antarmuka berbagi LetShare di desktop", mobileAlt: "Antarmuka berbagi LetShare di ponsel", transferReady: "Siap mentransfer", transferMeta: "Teks dan file", p2pFirst: "Utamakan P2P", roomReady: "Ruang siap", devicesOnline: "3 perangkat online",
    factsLabel: "Fitur produk", facts: ["WebRTC jika memungkinkan", "Cadangan teks melalui jaringan publik", "Browser desktop dan seluler", "Sumber terbuka"], whyKicker: "Sederhana dan cepat", whyTitle: "Fokus pada apa yang ingin dibagikan.", whyCopy: "LetShare memudahkan Anda memindahkan konten dari satu perangkat ke perangkat lain.",
    benefits: [{ eyebrow: "Tanpa akun", title: "Buka ruang, lalu bagikan.", copy: "Mulai dari browser: pilih file, teks, gambar, atau isi papan klip dan kirimkan." }, { eyebrow: "Lintas perangkat", title: "Dari komputer ke ponsel dengan mudah.", copy: "Komputer, ponsel, dan tablet dapat bergabung ke ruang yang sama untuk berbagi konten." }, { eyebrow: "Utamakan P2P", title: "Langsung jika memungkinkan, jelas jika tidak.", copy: "LetShare mencoba transfer peer-to-peer langsung dan menyediakan komunikasi teks melalui jaringan publik." }],
    flowKicker: "Cara pakai", flowTitle: "Satu ruang, tiga langkah.", steps: ["Buka LetShare di dua perangkat.", "Gabung ke ruang yang sama atau pindai kode QR.", "Kirim file, gambar, teks, atau isi papan klip."],
    connectionKicker: "Koneksi yang jelas", connectionTitle: "Lihat jalur koneksi dengan mudah.", connectionCopy: "Ganti pratinjau mode untuk melihat bagaimana aplikasi menjelaskan jalur koneksi.", modesLabel: "Pratinjau mode koneksi",
    modes: { direct: { label: "P2P", title: "Transfer langsung yang cepat", copy: "Jika jaringan mendukung, LetShare membuka jalur peer-to-peer agar transfer file besar menghindari perantara yang tidak perlu.", metric: "Jalur langsung" }, internet: { label: "Internet", title: "Jalur publik yang jelas", copy: "Jika koneksi langsung tidak tersedia, antarmuka menampilkan jalur jaringan publik dengan jelas.", metric: "Jalur publik" }, clipboard: { label: "Papan klip", title: "Kirim konten kecil dengan cepat", copy: "Teks, cuplikan, dan isi papan klip mudah dikirim saat Anda memerlukannya.", metric: "Berbagi cepat" } },
    laptop: "Komputer", phone: "Ponsel", showcaseKicker: "Tampilan produk", showcaseTitle: "Antarmuka nyata, bukan ilustrasi.", showcaseCopy: "Halaman ini menggunakan tangkapan layar LetShare agar Anda tahu apa yang akan terbuka.", showcaseAlt: "Tampilan LetShare di desktop", faqTitle: "Jawaban singkat sebelum mulai berbagi.",
    faqs: [{ question: "Apakah LetShare memerlukan akun?", answer: "Tidak. Buka browser dan mulai berbagi tanpa masuk ke akun." }, { question: "Apakah hanya berfungsi di Wi-Fi yang sama?", answer: "LetShare mencoba koneksi peer-to-peer terlebih dahulu; komunikasi teks yang didukung tetap dapat menggunakan jaringan publik jika koneksi langsung tidak tersedia." }, { question: "Mengapa halaman ini terpisah dari aplikasi?", answer: "Halaman pengenalan memiliki entri dan animasi tersendiri agar aplikasi berbagi tidak perlu memuat kode halaman ini." }],
  },
  en: {
    nav: "LetShare site navigation", openAppLabel: "Open LetShare app", sections: "Page sections", why: "Why", flow: "Flow", security: "Security", themeSelector: "Theme selector", useTheme: (theme) => `Use ${theme} theme`, language: "Language", openApp: "Open App",
    themes: { light: "Light", dark: "Dark", blue: "Blue", green: "Green", sunset: "Sunset", coolGray: "Cool gray" },
    kicker: "Browser-native sharing", hero: "Fast file, image, text, and clipboard sharing across nearby devices. No login, no install, and no confusing connection labels.", actions: "Primary actions", openSharing: "Open sharing app", github: "View GitHub", highlights: "LetShare highlights",
    metrics: [{ title: "No account", copy: "Start in the tab" }, { title: "P2P first", copy: "Direct when available" }, { title: "Fallback clear", copy: "Internet path shown" }],
    preview: "LetShare product preview", desktopAlt: "LetShare desktop sharing interface", mobileAlt: "LetShare mobile sharing interface", transferReady: "Transfer ready", transferMeta: "Text + file path", p2pFirst: "P2P first", roomReady: "Room ready", devicesOnline: "3 devices online",
    factsLabel: "Product facts", facts: ["WebRTC when possible", "Public network text fallback", "Desktop and mobile browsers", "Open source"], whyKicker: "Why it feels fast", whyTitle: "The page gets out of the way.", whyCopy: "LetShare is designed around the moment you already have: something on one device needs to be on another device.",
    benefits: [{ eyebrow: "No account", title: "Open a room and move the file.", copy: "LetShare starts in the browser. It keeps the first action close: pick a file, text, image, or clipboard content and send it." }, { eyebrow: "Every screen", title: "Desktop to phone without a detour.", copy: "The interface is built for mixed devices, so your laptop, phone, and tablet can meet in the same lightweight room." }, { eyebrow: "P2P first", title: "Direct when possible, resilient when not.", copy: "LetShare attempts direct peer-to-peer transfer and keeps text communication available through the public network path." }],
    flowKicker: "Flow", flowTitle: "One room, three steps.", steps: ["Open LetShare on two devices.", "Join the same room or scan the QR code.", "Send files, images, text, or clipboard content."],
    connectionKicker: "Connection clarity", connectionTitle: "Small status labels make a big difference.", connectionCopy: "Switch the mode preview to see how the product explains the path without making users decode networking language.", modesLabel: "Connection mode preview",
    modes: { direct: { label: "P2P", title: "Fast direct transfer", copy: "When the network allows it, LetShare opens a peer-to-peer channel so larger file transfers avoid unnecessary hops.", metric: "Direct path" }, internet: { label: "Internet", title: "Fallback that stays understandable", copy: "When a direct path cannot be established, the UI labels the public network path clearly instead of hiding it behind vague status text.", metric: "Public path" }, clipboard: { label: "Clipboard", title: "Small content stays instant", copy: "Text, snippets, and clipboard content stay close to the main action, so quick handoffs do not feel like file management.", metric: "Quick handoff" } },
    laptop: "Laptop", phone: "Phone", showcaseKicker: "Product signal", showcaseTitle: "A real interface, not a stock mockup.", showcaseCopy: "The landing page uses the actual LetShare screenshots so visitors understand what opens after the first click.", showcaseAlt: "LetShare desktop product view", faqTitle: "Quick answers before the first transfer.",
    faqs: [{ question: "Does LetShare need an account?", answer: "No. The app is designed for quick sharing from the browser without a sign-in step." }, { question: "Does it only work on the same Wi-Fi?", answer: "LetShare tries peer-to-peer first and can still use the public network path for supported text communication when direct connection is unavailable." }, { question: "Why is this separate from the app root?", answer: "The landing page has its own HTML entry and animation bundle, so the sharing tool at the root URL does not load the marketing page code." }],
  },
  zh: {
    nav: "LetShare 网站导航", openAppLabel: "打开 LetShare 应用", sections: "页面栏目", why: "产品优势", flow: "使用步骤", security: "连接方式", themeSelector: "选择主题", useTheme: (theme) => `使用${theme}主题`, language: "语言", openApp: "打开应用",
    themes: { light: "浅色", dark: "深色", blue: "蓝色", green: "绿色", sunset: "日落", coolGray: "冷灰" },
    kicker: "浏览器里的便捷分享", hero: "在设备之间快速分享文件、图片、文字和剪贴板内容，无需登录或安装，连接状态一目了然。", actions: "主要操作", openSharing: "打开分享应用", github: "查看 GitHub", highlights: "LetShare 特色",
    metrics: [{ title: "无需账号", copy: "打开网页即可使用" }, { title: "优先 P2P", copy: "条件允许时直连" }, { title: "状态清晰", copy: "展示公网连接方式" }],
    preview: "LetShare 产品预览", desktopAlt: "LetShare 桌面端分享界面", mobileAlt: "LetShare 手机端分享界面", transferReady: "准备传输", transferMeta: "文字与文件", p2pFirst: "优先 P2P", roomReady: "房间已就绪", devicesOnline: "3 台设备在线",
    factsLabel: "产品特点", facts: ["支持时使用 WebRTC", "文字支持公网回退", "支持电脑和手机浏览器", "开源项目"], whyKicker: "简单高效", whyTitle: "把注意力留给分享本身。", whyCopy: "当你需要把一台设备上的内容传到另一台设备，LetShare 让这个过程更简单。",
    benefits: [{ eyebrow: "无需账号", title: "打开房间，即可分享。", copy: "直接在浏览器中选择文件、文字、图片或剪贴板内容，然后发送给对方。" }, { eyebrow: "跨设备", title: "电脑与手机轻松互传。", copy: "电脑、手机和平板可以加入同一个轻量房间，在不同设备之间分享内容。" }, { eyebrow: "优先 P2P", title: "优先直连，连接方式清晰。", copy: "LetShare 会尝试点对点传输，也支持通过公网通道进行文字通信。" }],
    flowKicker: "使用步骤", flowTitle: "一个房间，三步完成。", steps: ["在两台设备上打开 LetShare。", "加入同一个房间，或扫描二维码。", "发送文件、图片、文字或剪贴板内容。"],
    connectionKicker: "连接状态清晰可见", connectionTitle: "连接方式，一眼就能看懂。", connectionCopy: "切换下方预览，了解产品如何清楚地展示不同连接方式。", modesLabel: "连接方式预览",
    modes: { direct: { label: "P2P", title: "点对点直传", copy: "网络条件允许时，LetShare 会建立点对点通道，让较大的文件传输减少不必要的中转。", metric: "直连通道" }, internet: { label: "公网", title: "清楚展示公网连接", copy: "无法建立直连时，界面会清晰标明公网连接状态，让你知道当前使用的通道。", metric: "公网通道" }, clipboard: { label: "剪贴板", title: "随手分享小段内容", copy: "文字、片段和剪贴板内容都能快速发送，方便设备之间随手传递。", metric: "快速分享" } },
    laptop: "电脑", phone: "手机", showcaseKicker: "真实产品界面", showcaseTitle: "看到的，就是真实界面。", showcaseCopy: "这里展示的是 LetShare 的真实截图，让你在打开应用前了解它的样子。", showcaseAlt: "LetShare 桌面端产品界面", faqTitle: "开始分享前，先看看这些问题。",
    faqs: [{ question: "使用 LetShare 需要注册账号吗？", answer: "不需要。打开浏览器即可快速分享，无需登录。" }, { question: "只能在同一个 Wi-Fi 下使用吗？", answer: "LetShare 优先尝试点对点连接；无法直连时，支持的文字通信仍可通过公网通道进行。" }, { question: "为什么介绍页和应用是分开的？", answer: "介绍页有独立的入口和动画资源，打开分享工具时无需加载介绍页代码。" }],
  },
};
