// Phrases for words drawn in the 3D office: signs, boards, cards and name tags, and the sky's line in
// Settings. Names (people, projects, places on the scenic loop, a map's own board names) stay as written.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {
  // Signs on the walls and over the doors.
  'world.exit': 'EXIT',
  'world.garage': '🏎️  GARAGE',
  'world.garageLift': '🛗 Garage',
  'world.meetingRoom': '🤝 Meeting room',
  'world.smokeBreak': '🚬 Smoke break',
  'world.boss': '👑 BOSS',
  'world.bossOffice': '👑 Boss Office',
  'world.askMe': '{icon} Ask me',
  'world.rip': 'R.I.P.',

  // The sign at the back office, for how far it's built out.
  'world.wing.grow': '🚧 Room to grow',
  'world.wing.knock': 'Press E to knock through: 2 more desks',
  'world.wing.more': 'Press E to go back another row: 2 more desks',
  'world.wing.full': '🏢 As big as it gets',
  'world.wing.fullSub': 'The back office is built all the way out',

  // The office's boards, and the boards of the castle and the space station (a map's own names stay).
  'world.board.issues': 'Issues',
  'world.board.queue': '📋 Task queue',
  'world.board.pulls': 'Pull Requests',
  'world.board.services': '🌐 Services',
  'world.board.petitions': '📜 Petitions',
  'world.board.orders': '📋 Orders of the day',
  'world.board.decrees': '🔀 Decrees for the seal',
  'world.board.signals': '📡 Incoming signals',
  'world.board.missions': '📋 Mission queue',
  'world.board.docking': '🔀 Docking requests',
  'world.board.subsystems': '🌐 Subsystems',

  // The scenic loop.
  'world.scenic.title': '🏎️ SCENIC LOOP',
  'world.scenic.sub': '🌾 farm · 🌲 pines · 🏔️ mountains · 🏖️ beach: 1.4 km, either way ⟷',
  'world.scenic.east': '🏔️ Scenic Loop ⟶',
  'world.scenic.west': '⟵ Scenic Loop 🏖️',
  'world.scenic.snacks': '🍦 Snacks',

  // The space station and the castle.
  'world.station.name': '🛰️ {name} STATION',
  'world.station.drinks': '☕ Hot drinks',
  'world.station.briefing': '🤝 Briefing room',
  'world.station.dock': '🚀 Docking port',
  'world.station.airlock': '⚠️ Airlock',
  'world.castle.council': '🤝 The small council',
  'world.castle.ale': '🍺 Ale',

  // The station's screens.
  'world.readout.orbit': 'ORBIT 412 KM',
  'world.readout.oxygen': 'O₂ 98.6%',
  'world.readout.hull': 'HULL OK',
  'world.readout.pressure': 'PRESSURE 101 kPa',
  'world.readout.solar': 'SOLAR 84 kW',
  'world.readout.crew': 'CREW ABOARD',
  'world.readout.airlock': 'AIRLOCK SEALED',
  'world.readout.comms': 'COMMS LINKED',
  'world.readout.thrust': 'THRUST STANDBY',
  'world.readout.gravity': 'GRAVITY 1.0 G',

  // A subagent's chip, and the sign for the ones past those shown.
  'world.subagent.workflow': 'workflow',
  'world.subagent.explore': '🔎 EXPLORE',
  'world.subagent.plan': '📐 PLAN',
  'world.subagent.agent': '🤖 AGENT',
  'world.subagent.more': { one: '+{n} more', other: '+{n} more' },

  // The sky over the office, in Settings: "🌙 Clear · 9:41 PM outside · Berlin, Germany, 11 °C".
  'world.sky.clear': 'Clear',
  'world.sky.cloudy': 'Cloudy',
  'world.sky.rain': 'Rain',
  'world.sky.storm': 'Thunderstorm',
  'world.sky.snow': 'Snow',
  'world.sky.fog': 'Fog',
  'world.sky.now': '{icon} {weather} · {time} outside{where}',
  'world.sky.where': ' · {city}{temp}',
  'world.sky.temp': ', {temp} °C',
} as const satisfies Strings;

export const ar: Arabic<typeof en> = {
  'world.exit': 'خروج',
  'world.garage': '🏎️  الجراج',
  'world.garageLift': '🛗 الجراج',
  'world.meetingRoom': '🤝 غرفة الاجتماعات',
  'world.smokeBreak': '🚬 استراحة تدخين',
  'world.boss': '👑 المدير',
  'world.bossOffice': '👑 مكتب المدير',
  'world.askMe': '{icon} اسألني',
  'world.rip': 'ارقد بسلام',

  'world.wing.grow': '🚧 مساحة للتوسع',
  'world.wing.knock': 'اضغط E لهدم الجدار: مكتبان إضافيان',
  'world.wing.more': 'اضغط E لإضافة صف آخر: مكتبان إضافيان',
  'world.wing.full': '🏢 أقصى حجم ممكن',
  'world.wing.fullSub': 'اكتمل بناء المكتب الخلفي',

  'world.board.issues': 'Issues',
  'world.board.queue': '📋 قائمة المهام',
  'world.board.pulls': 'طلبات الدمج',
  'world.board.services': '🌐 الخدمات',
  'world.board.petitions': '📜 العرائض',
  'world.board.orders': '📋 أوامر اليوم',
  'world.board.decrees': '🔀 مراسيم للختم',
  'world.board.signals': '📡 إشارات واردة',
  'world.board.missions': '📋 قائمة المهمات',
  'world.board.docking': '🔀 طلبات الالتحام',
  'world.board.subsystems': '🌐 الأنظمة الفرعية',

  'world.scenic.title': '🏎️ الطريق الدائري',
  'world.scenic.sub': '🌾 مزرعة · 🌲 صنوبر · 🏔️ جبال · 🏖️ شاطئ: 1.4 كم، في الاتجاهين ⟷',
  // Read right to left, so the arrow comes first to stay on the side it points to.
  'world.scenic.east': '⟶ الطريق الدائري 🏔️',
  'world.scenic.west': '🏖️ الطريق الدائري ⟵',
  'world.scenic.snacks': '🍦 وجبات خفيفة',

  'world.station.name': '🛰️ محطة {name}',
  'world.station.drinks': '☕ مشروبات ساخنة',
  'world.station.briefing': '🤝 غرفة الإحاطة',
  'world.station.dock': '🚀 منفذ الالتحام',
  'world.station.airlock': '⚠️ حجرة الضغط',
  'world.castle.council': '🤝 المجلس الصغير',
  'world.castle.ale': '🍺 جعة',

  'world.readout.orbit': 'المدار 412 كم',
  'world.readout.oxygen': 'O₂ 98.6%',
  'world.readout.hull': 'الهيكل سليم',
  'world.readout.pressure': 'الضغط 101 kPa',
  'world.readout.solar': 'الطاقة 84 kW',
  'world.readout.crew': 'الطاقم على المتن',
  'world.readout.airlock': 'الحجرة محكمة',
  'world.readout.comms': 'الاتصال متاح',
  'world.readout.thrust': 'الدفع جاهز',
  'world.readout.gravity': 'الجاذبية 1.0 G',

  'world.subagent.workflow': 'مسار عمل',
  'world.subagent.explore': '🔎 استكشاف',
  'world.subagent.plan': '📐 تخطيط',
  'world.subagent.agent': '🤖 وكيل',
  'world.subagent.more': { zero: '+{n}', one: '+{n} آخر', two: '+{n} آخران', few: '+{n} آخرين', many: '+{n} آخرين', other: '+{n} آخرين' },

  'world.sky.clear': 'صافٍ',
  'world.sky.cloudy': 'غائم',
  'world.sky.rain': 'ممطر',
  'world.sky.storm': 'عاصفة رعدية',
  'world.sky.snow': 'ثلج',
  'world.sky.fog': 'ضباب',
  'world.sky.now': '{icon} {weather} · {time} في الخارج{where}',
  'world.sky.where': ' · {city}{temp}',
  'world.sky.temp': '، {temp} °C',
};
