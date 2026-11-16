// Dataset kategori bawaan QuickMark Pro — rule-based, offline.
// Struktur per kategori:
//   id       — dipakai sebagai categoryId di IndexedDB (stabil, jangan diubah)
//   name     — label tampil
//   color    — accent chip
//   icon     — nama ikon SVG bawaan (lihat ui.js ICONS)
//   domains  — mapping domain (host, tanpa www.) → kategori ini (aturan #2: domain)
//   keywords — kata kunci pada URL path / judul (aturan #3: keyword)
// tldRules — mapping akhiran host (mis. '.gov') yang berlaku global.
// Urutan penilaian classifier: learning user → tld → domains → keywords (lihat categorizer.js).

export const BUILTIN_CATEGORIES = [
  {
    id: 'dev',
    name: 'Dev',
    color: '#5eead4',
    icon: 'code',
    domains: [
      'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com',
      'developer.mozilla.org', 'npmjs.com', 'nodejs.org', 'python.org', 'docs.python.org',
      'devdocs.io', 'caniuse.com', 'regex101.com', 'codepen.io', 'codesandbox.io',
      'vercel.com', 'netlify.com', 'docker.com', 'hub.docker.com', 'kubernetes.io',
      'developer.chrome.com', 'learn.microsoft.com', 'aws.amazon.com', 'cloud.google.com',
      'supabase.com', 'firebase.google.com', 'postgresql.org', 'sqlite.org', 'redis.io',
      'react.dev', 'vuejs.org', 'angular.dev', 'svelte.dev', 'nextjs.org', 'vitejs.dev',
      'typescriptlang.org', 'tailwindcss.com', 'mdn.dev', 'web.dev', 'huggingface.co',
      'jetbrains.com', 'code.visualstudio.com', 'leetcode.com', 'hackerrank.com', 'freecodecamp.org'
    ],
    keywords: ['github', 'gitlab', 'repo', 'docs', 'api', 'sdk', 'tutorial', 'dev', 'developer', 'code', 'snippet', 'npm', 'stacktrace']
  },
  {
    id: 'design',
    name: 'Desain',
    color: '#a78bfa',
    icon: 'palette',
    domains: [
      'figma.com', 'dribbble.com', 'behance.net', 'unsplash.com', 'pexels.com', 'pixabay.com',
      'coolors.co', 'fontsinuse.com', 'fonts.google.com', 'fontshare.com', 'lottiefiles.com',
      'iconify.design', 'heroicons.com', 'lucide.dev', 'fontawesome.com', 'canva.com',
      'framer.com', 'webflow.com', 'awwwards.com', 'mobbin.com', 'uigarage.net', 'pttrns.com'
    ],
    keywords: ['design', 'ui', 'ux', 'mockup', 'wireframe', 'typography', 'font', 'icon', 'palette', 'figma']
  },
  {
    id: 'social',
    name: 'Sosial Media',
    color: '#60a5fa',
    icon: 'users',
    domains: [
      'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'threads.net', 'tiktok.com',
      'linkedin.com', 'reddit.com', 'pinterest.com', 'discord.com', 't.me', 'telegram.org',
      'mastodon.social', 'bluesky.social', 'snapchat.com', 'whatsapp.com', 'quora.com'
    ],
    keywords: ['facebook', 'instagram', 'twitter', 'tiktok', 'linkedin', 'reddit', 'discord']
  },
  {
    id: 'shop',
    name: 'Belanja',
    color: '#fbbf24',
    icon: 'cart',
    domains: [
      'tokopedia.com', 'shopee.co.id', 'shopee.com', 'lazada.co.id', 'bukalapak.com',
      'blibli.com', 'zalora.co.id', 'amazon.com', 'ebay.com', 'aliexpress.com', 'temu.com',
      'alibaba.com', 'walmart.com', 'etsy.com', 'aliexpress.us', 'shein.com', 'zara.com',
      'uniqlo.com', 'oleole.co.id', 'gramedia.com', 'eracomputers.store', 'enterkomputer.com'
    ],
    keywords: ['shop', 'toko', 'promo', 'diskon', 'cart', 'keranjang', 'checkout', 'beli', 'flash-sale', 'voucher', 'kupon']
  },
  {
    id: 'news',
    name: 'Berita',
    color: '#f87171',
    icon: 'news',
    domains: [
      'kompas.com', 'detik.com', 'tempo.co', 'cnbcindonesia.com', 'kumparan.com', 'tirto.id',
      'katadata.co.id', 'liputan6.com', 'okezone.com', 'antaranews.com', 'republika.co.id',
      'bbc.com', 'bbc.co.uk', 'cnn.com', 'theguardian.com', 'nytimes.com', 'washingtonpost.com',
      'reuters.com', 'apnews.com', 'bloomberg.com', 'wsj.com', 'aljazeera.com', 'dw.com',
      'theverge.com', 'arstechnica.com', 'techcrunch.com', 'wired.com'
    ],
    keywords: ['berita', 'news', 'headline', 'koran', 'press', 'artikel']
  },
  {
    id: 'entertainment',
    name: 'Hiburan',
    color: '#fb923c',
    icon: 'play',
    domains: [
      'youtube.com', 'youtu.be', 'netflix.com', 'disneyplus.com', 'disneyplus.hotstar.com',
      'primevideo.com', 'hbomax.com', 'max.com', 'spotify.com', 'soundcloud.com',
      'tidal.com', 'vidio.com', 'viu.com', 'wetv.com', 'crunchyroll.com', 'bilibili.tv',
      'twitch.tv', 'imdb.com', 'rottentomatoes.com', 'letterboxd.com', '9gag.com'
    ],
    keywords: ['video', 'film', 'movie', 'series', 'trailer', 'musik', 'music', 'playlist', 'streaming', 'anime', 'komedi']
  },
  {
    id: 'learning',
    name: 'Belajar',
    color: '#34d399',
    icon: 'book',
    domains: [
      'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'dicoding.com', 'buildwithangga.com',
      'skillacademy.com', 'ruangguru.com', 'zenius.net', 'brilliant.org', 'duolingo.com',
      'w3schools.com', 'geeksforgeeks.org', 'roadmap.sh', 'frontendmasters.com', 'pluralsight.com',
      'ocw.mit.edu', 'openstax.org', 'www.dicoding.id'
    ],
    keywords: ['kursus', 'course', 'belajar', 'lesson', 'quiz', 'latihan', 'exam', 'bootcamp', 'certification']
  },
  {
    id: 'productivity',
    name: 'Produktivitas',
    color: '#38bdf8',
    icon: 'check',
    domains: [
      'notion.so', 'linear.app', 'asana.com', 'trello.com', 'clickup.com', 'monday.com',
      'slack.com', 'zoom.us', 'meet.google.com', 'calendly.com', 'cal.com', 'obsidian.md',
      'todoist.com', 'ticktick.com', 'any.do', 'airtable.com', 'miro.com', 'excalidraw.com',
      'docs.google.com', 'sheets.google.com', 'slides.google.com', 'drive.google.com', 'office.com',
      'one.google.com'
    ],
    keywords: ['task', 'todo', 'notes', 'kanban', 'meeting', 'dokumen', 'document', 'spreadsheet', 'planner']
  },
  {
    id: 'finance',
    name: 'Keuangan',
    color: '#4ade80',
    icon: 'wallet',
    domains: [
      'internet.bca.co.id', 'ibank.klikbca.com', 'midtrans.com', 'xendit.co', 'flip.id',
      'ovo.id', 'dana.co.id', 'gopay.co.id', 'shopeepay.co.id', 'linkaja.id',
      'morningstar.com', 'investing.com', 'tradingview.com', 'coinmarketcap.com', 'coinbase.com',
      'binance.com', 'tokocrypto.com', 'indodax.com', 'pendanaan.com', 'securities.co.id', 'bibit.id',
      'stockbit.com', 'ajaib.co.id', 'miraeasset.co.id'
    ],
    keywords: ['bank', 'payment', 'pembayaran', 'investasi', 'saham', 'crypto', 'portofolio', 'fintech', 'e-wallet']
  },
  {
    id: 'travel',
    name: 'Travel',
    color: '#22d3ee',
    icon: 'plane',
    domains: [
      'traveloka.com', 'tiket.com', 'agoda.com', 'booking.com', 'airbnb.com', 'expedia.com',
      'tripadvisor.com', 'skyscanner.net', 'trivago.com', 'pegipegi.com', 'garuda-indonesia.com',
      'lionair.co.id', 'citilink.co.id', 'kereta-api.co.id', 'kai.id', 'bluebird.co.id', 'gojek.com', 'grab.com'
    ],
    keywords: ['hotel', 'flight', 'pesawat', 'tiket', 'wisata', 'trip', 'liburan', 'travel', 'itinerary']
  },
  {
    id: 'game',
    name: 'Game',
    color: '#c084fc',
    icon: 'gamepad',
    domains: [
      'store.steampowered.com', 'epicgames.com', 'gog.com', 'itch.io', 'playstation.com',
      'xbox.com', 'nintendo.com', 'ea.com', 'ubisoft.com', 'riotgames.com', 'blizzard.com',
      'minecraft.net', 'roblox.com', 'chess.com', 'lichess.org', 'speedrun.com', 'steamcommunity.com'
    ],
    keywords: ['game', 'gaming', 'steam', 'esport', 'gameplay', 'walkthrough', 'patch-notes']
  },
  {
    id: 'gov',
    name: 'Pemerintahan',
    color: '#94a3b8',
    icon: 'building',
    domains: [
      'go.id', 'gov.uk', 'gov', 'kemdikbud.go.id', 'kemkes.go.id', 'imigrasi.go.id',
      'pjka', 'ssp', 'djponline.pajak.go.id', 'pajak.go.id', 'sspd.jakarta.go.id',
      'ketentuan', 'e-visa', 'esaku', 'oss.go.id', 'bkpm.go.id', 'sido.kemendag.go.id'
    ],
    keywords: ['pemerintah', 'pajak', 'ktp', 'paspor', 'perizinan', 'e-government', 'izin']
  },
  {
    id: 'tools',
    name: 'Tools Web',
    color: '#facc15',
    icon: 'tool',
    domains: [
      'tinypng.com', 'squoosh.app', 'ilovepdf.com', 'smallpdf.com', 'pdf24.org', 'sejda.com',
      'remove.bg', 'onlinevideoconverter.com', 'cloudconvert.com', 'convertio.co', 'deepai.org',
      'quickref.dev', 'overleaf.com', 'carbon.now.sh', 'ray.so', 'shorturl.at', 'bitly.com',
      'temp-mail.org', '1secmail.com', 'mytemp.email'
    ],
    keywords: ['converter', 'compress', 'resize', 'editor online', 'generator', 'temporary mail', 'pdf tools']
  }
];

// Aturan akhiran host (TLD) — cek SEBELUM domains, SETELAH learning.
// key = akhiran host (lowercase, diawali '.'), value = categoryId.
export const TLD_RULES = {
  '.gov': 'gov',
  '.gov.uk': 'gov',
  '.go.id': 'gov',
  '.ac.id': 'learning',
  '.sch.id': 'learning',
  '.edu': 'learning',
  '.edu.id': 'learning'
};

// ID kategori bawaan — dipakai untuk mapping & setting on/off dataset.
export const BUILTIN_IDS = BUILTIN_CATEGORIES.map((c) => c.id);
