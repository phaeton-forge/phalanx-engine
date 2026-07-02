export type Language = 'en' | 'ru';

type Dict = Record<string, string>;

const dictionaries: Record<Language, Dict> = {
  en: {
    // Main menu
    'mainMenu.titleText': 'CHAPAEV',
    'mainMenu.subtitle': 'Flick Checkers',
    'mainMenu.findOpponent': '🔍 Find opponent',
    'mainMenu.privateMatch': '🔑 Private match',
    'mainMenu.localGame': '🎮 Local game',
    'mainMenu.settings': '⚙️ Settings',

    // Local game mode selection
    'localMode.title': 'Local game',
    'localMode.subtitle': 'Choose game mode',
    'localMode.vsAi': '🤖 Game vs AI',
    'localMode.hotseat': '👥 Hot-seat',

    // Game HUD
    'hud.player1': 'Player 1',
    'hud.player2': 'Player 2',
    'hud.round': 'Round {round}',
    'hud.yourTurn': 'Your turn',
    'hud.opponentTurn': "Opponent's turn",
    'hud.turnTeam': 'Turn: {team}',
    'hud.team.white': 'white',
    'hud.team.black': 'black',
    'hud.settingsTitle': 'Settings',
    'hud.pauseTitle': 'Pause',
    'hud.exitTitle': 'Exit',

    // Matchmaking
    'matchmaking.searching': 'Searching for an opponent...',
    'matchmaking.waitingTime': 'Waiting time: {time}',
    'matchmaking.cancel': 'Cancel',
    'matchmaking.found': 'Opponent found!',
    'matchmaking.player1': 'Player 1',
    'matchmaking.player2': 'Player 2',

    // Pause overlay
    'pause.title': '⏸️ PAUSED',
    'pause.paused': 'Game paused',
    'pause.youPaused': 'You paused the game',
    'pause.opponentPaused': 'Opponent paused the game',
    'pause.resume': '▶️ Resume',
    'pause.leaveMatch': '🏠 Leave match',

    // Match result
    'matchResult.victoryTitle': '🏆 VICTORY! 🏆',
    'matchResult.defeatTitle': 'DEFEAT',
    'matchResult.victorySubtitle': 'Great game!',
    'matchResult.defeatSubtitle': "You'll get it next time!",
    'matchResult.durationLabel': 'Match time: ',
    'matchResult.rematch': '🔄 Rematch',
    'matchResult.findNew': '🔍 Find new',
    'matchResult.toMenu': '🏠 Menu',

    // Profile
    'profile.guest': 'Guest',
    'profile.statsTitle': 'Statistics',
    'profile.comingSoon': 'Coming soon',
    'common.back': '← Back',

    // Private match
    'privateMatch.title': 'Private match',
    'privateMatch.createRoom': 'Create room',
    'privateMatch.or': 'or',
    'privateMatch.roomCodePlaceholder': 'Room code...',
    'privateMatch.join': 'Join',
    'privateMatch.roomCreated': 'Room created!',
    'privateMatch.copyCode': '📋 Copy code',
    'privateMatch.copyLinkLabel': 'Invite link:',
    'privateMatch.waitingOpponent': 'Waiting for opponent...',
    'privateMatch.copied': '✅ Copied!',
    'privateMatch.error': '❌ Error',

    // Settings
    'settings.title': '⚙️ Settings',
    'settings.music': '🎵 Music',
    'settings.sounds': '🔊 Sounds',
    'settings.rules': '📜 Game rules',

    // Rules
    'rules.title': '📜 Game rules',
    'rules.html': [
      '<p><strong>Chapaev</strong> is a board game for two players where checkers are flicked off the board.</p>',
      '<p><strong>Setup.</strong> Each player places 8 checkers on the closest rank. White starts at the bottom, black at the top.</p>',
      '<p><strong>Move.</strong> Players take turns. On your turn, you flick one of your checkers toward the opponent’s. The goal is to knock enemy checkers off the board. If your checker goes off the edge, it also leaves the round.</p>',
      '<p><strong>End of round.</strong> A round ends when one player has no checkers left on the board. The round winner advances their checkers one rank forward. If both sides lose all checkers at the same time, it’s a draw and the round is replayed.</p>',
      '<p><strong>Win.</strong> You win by being the first to reach the opposite edge of the board (the opponent’s last rank), winning round after round.</p>',
      '<p><strong>Tip:</strong> Try hitting at a tangent to knock out multiple enemy checkers with one flick and keep yours on the board!</p>',
    ].join('\n'),

    // Network / statuses / toasts
    'net.connecting': 'Connecting to server...',
    'net.creatingRoom': 'Creating room...',
    'net.joiningRoom': 'Joining room...',
    'net.connectionLost': 'Connection lost',
    'net.searchingOpponent': 'Searching for an opponent...',
    'net.connectionError': 'Connection error',
    'net.errorPrefix': 'Error: {message}',
    'recovery.roomExpired': 'Room expired',
    'recovery.waitingNetwork': 'Waiting for network…',
    'recovery.restoring': 'Restoring connection…',
    'recovery.retrying': 'Connection lost. Retrying in {seconds}s…',
    'recovery.gaveUp': 'Failed to restore connection',

    // In-game / toasts
    'toast.opponentLeft': 'Opponent left the match',
    'toast.roundDraw': 'Round draw',
    'toast.roundWon.hotseat.white': 'White won the round!',
    'toast.roundWon.hotseat.black': 'Black won the round!',
    'toast.roundWon': 'Round won!',
    'toast.roundLost': 'Round lost',
    'toast.matchWon.hotseat.white': '🏆 White wins!',
    'toast.matchWon.hotseat.black': '🏆 Black wins!',
    'toast.matchWon': '🏆 You win the match!',
    'toast.matchLost': 'Defeat',

    // Names
    'name.you': 'You',
    'name.opponent': 'Opponent',
    'name.whiteTeam': 'White',
    'name.blackTeam': 'Black',
    'name.ai': 'AI',
  },
  ru: {
    // Main menu
    'mainMenu.titleText': 'ЧАПАЕВ',
    'mainMenu.subtitle': 'Настольная игра онлайн',
    'mainMenu.findOpponent': '🔍 Найти соперника',
    'mainMenu.privateMatch': '🔑 Приватный матч',
    'mainMenu.localGame': '🎮 Локальная игра',
    'mainMenu.settings': '⚙️ Настройки',

    // Local game mode selection
    'localMode.title': 'Локальная игра',
    'localMode.subtitle': 'Выберите режим игры',
    'localMode.vsAi': '🤖 Игра с ИИ',
    'localMode.hotseat': '👥 Игра на одном экране',

    // Game HUD
    'hud.player1': 'Игрок 1',
    'hud.player2': 'Игрок 2',
    'hud.round': 'Раунд {round}',
    'hud.yourTurn': 'Ваш ход',
    'hud.opponentTurn': 'Ход соперника',
    'hud.turnTeam': 'Ход {team}',
    'hud.team.white': 'белых',
    'hud.team.black': 'чёрных',
    'hud.settingsTitle': 'Настройки',
    'hud.pauseTitle': 'Пауза',
    'hud.exitTitle': 'Выход',

    // Matchmaking
    'matchmaking.searching': 'Поиск соперника...',
    'matchmaking.waitingTime': 'Время ожидания: {time}',
    'matchmaking.cancel': 'Отменить',
    'matchmaking.found': 'Соперник найден!',
    'matchmaking.player1': 'Игрок 1',
    'matchmaking.player2': 'Игрок 2',

    // Pause overlay
    'pause.title': '⏸️ ПАУЗА',
    'pause.paused': 'Игра приостановлена',
    'pause.youPaused': 'Вы поставили игру на паузу',
    'pause.opponentPaused': 'Соперник поставил игру на паузу',
    'pause.resume': '▶️ Продолжить',
    'pause.leaveMatch': '🏠 Покинуть матч',

    // Match result
    'matchResult.victoryTitle': '🏆 ПОБЕДА! 🏆',
    'matchResult.defeatTitle': 'ПОРАЖЕНИЕ',
    'matchResult.victorySubtitle': 'Отличная игра!',
    'matchResult.defeatSubtitle': 'В следующий раз повезёт!',
    'matchResult.durationLabel': 'Время матча: ',
    'matchResult.rematch': '🔄 Реванш',
    'matchResult.findNew': '🔍 Найти нового',
    'matchResult.toMenu': '🏠 В меню',

    // Profile
    'profile.guest': 'Гость',
    'profile.statsTitle': 'Статистика',
    'profile.comingSoon': 'Будет позже',
    'common.back': '← Назад',

    // Private match
    'privateMatch.title': 'Приватный матч',
    'privateMatch.createRoom': 'Создать комнату',
    'privateMatch.or': 'или',
    'privateMatch.roomCodePlaceholder': 'Код комнаты...',
    'privateMatch.join': 'Войти',
    'privateMatch.roomCreated': 'Комната создана!',
    'privateMatch.copyCode': '📋 Копировать код',
    'privateMatch.copyLinkLabel': 'Ссылка для приглашения:',
    'privateMatch.waitingOpponent': 'Ожидание соперника...',
    'privateMatch.copied': '✅ Скопировано!',
    'privateMatch.error': '❌ Ошибка',

    // Settings
    'settings.title': '⚙️ Настройки',
    'settings.music': '🎵 Музыка',
    'settings.sounds': '🔊 Звуки',
    'settings.rules': '📜 Правила игры',

    // Rules
    'rules.title': '📜 Правила игры',
    'rules.html': [
      '<p><strong>Чапаев</strong> — настольная игра для двух игроков, в которой шашки выбиваются',
      'щелчками с доски. Игра названа в честь героя Гражданской войны Василия Чапаева.</p>',
      '<p><strong>Подготовка.</strong> Каждый игрок расставляет 8 шашек на ближайшей к себе',
      'горизонтали шахматной доски. Белые занимают нижний ряд, чёрные — верхний.</p>',
      '<p><strong>Ход.</strong> Игроки ходят по очереди. За один ход нужно щёлкнуть (сделать',
      '«флик») по одной из своих шашек, направив её в сторону шашек соперника. Цель —',
      'вытолкнуть чужие шашки за пределы доски. Если ваша шашка сама вылетает за край —',
      'она тоже выбывает из раунда.</p>',
      '<p><strong>Конец раунда.</strong> Раунд завершается, когда у одного из игроков не',
      'остаётся шашек на доске. Победитель раунда продвигает свои шашки на одну',
      'горизонталь вперёд. Если обе стороны потеряли все шашки одновременно — ничья,',
      'раунд переигрывается.</p>',
      '<p><strong>Победа.</strong> Побеждает тот, кто первым доведёт свои шашки до',
      'противоположного края доски (последней горизонтали соперника), выигрывая',
      'раунд за раундом.</p>',
      '<p><strong>Совет:</strong> Старайтесь бить по касательной, чтобы одним ударом',
      'выбить сразу несколько шашек соперника и сохранить свою на доске!</p>',
    ].join(' '),

    // Network / statuses / toasts
    'net.connecting': 'Подключение к серверу...',
    'net.creatingRoom': 'Создание комнаты...',
    'net.joiningRoom': 'Присоединение к комнате...',
    'net.connectionLost': 'Соединение потеряно',
    'net.searchingOpponent': 'Поиск соперника...',
    'net.connectionError': 'Ошибка подключения',
    'net.errorPrefix': 'Ошибка: {message}',
    'recovery.roomExpired': 'Комната истекла',
    'recovery.waitingNetwork': 'Ожидание сети…',
    'recovery.restoring': 'Восстановление подключения…',
    'recovery.retrying': 'Соединение потеряно. Повтор через {seconds}с…',
    'recovery.gaveUp': 'Не удалось восстановить соединение',

    // In-game / toasts
    'toast.opponentLeft': 'Соперник покинул матч',
    'toast.roundDraw': 'Ничья в раунде',
    'toast.roundWon.hotseat.white': 'Белые выиграли раунд!',
    'toast.roundWon.hotseat.black': 'Чёрные выиграли раунд!',
    'toast.roundWon': 'Раунд выигран!',
    'toast.roundLost': 'Раунд проигран',
    'toast.matchWon.hotseat.white': '🏆 Белые победили!',
    'toast.matchWon.hotseat.black': '🏆 Чёрные победили!',
    'toast.matchWon': '🏆 Победа в партии!',
    'toast.matchLost': 'Поражение',

    // Names
    'name.you': 'Вы',
    'name.opponent': 'Соперник',
    'name.whiteTeam': 'Белые',
    'name.blackTeam': 'Чёрные',
    'name.ai': 'ИИ',
  },
};

let currentLanguage: Language | null = null;

function detectLanguage(): Language {
  const nav = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en';
  const lang = nav.toLowerCase();
  return lang.startsWith('ru') ? 'ru' : 'en';
}

export function getLanguage(): Language {
  if (currentLanguage) return currentLanguage;
  try {
    const stored = localStorage.getItem('lang');
    if (stored === 'ru' || stored === 'en') {
      currentLanguage = stored;
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  currentLanguage = detectLanguage();
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {
    // ignore storage errors
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLanguage();
  const dict = dictionaries[lang];
  const fallback = dictionaries.en;
  const template = dict[key] ?? fallback[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

