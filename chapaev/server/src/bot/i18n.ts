export type Lang = 'ru' | 'en';

export function pickLang(languageCode: string | undefined): Lang {
  if (!languageCode) return 'en';
  const code = languageCode.toLowerCase().slice(0, 2);
  return code === 'ru' || code === 'uk' || code === 'be' ? 'ru' : 'en';
}

export const strings = {
  ru: {
    startNew:
      '👋 Добро пожаловать в Чапаев!\n\nВыбивай шашки соперника с поля — побеждает тот, кто выбьет все.\n\nНажми «Играть», чтобы начать.',
    startReturn: '👋 С возвращением! Готов сыграть?',
    play: '🎮 Нажми кнопку ниже, чтобы начать игру.',
    friends:
      '👥 Я создал приватную комнату. Отправь ссылку другу — он сразу подключится к игре:',
    friendsShareText: 'Сыграем в Чапаева? Заходи в комнату:',
    friendsError: 'Не получилось создать комнату. Попробуй ещё раз через пару секунд.',
    help:
      '📖 *Правила Чапаева*\n\n' +
      '• Цель — выбить все шашки соперника за пределы доски.\n' +
      '• Ходят по очереди: щёлкни по своей шашке и тяни в нужном направлении.\n' +
      '• Нельзя двигать шашки соперника напрямую.\n' +
      '• Выигрывает тот, у кого на доске не останется шашек соперника.',
    btnPlay: '🎮 Играть',
    btnInvite: '👥 Пригласить друга',
    btnShare: '📤 Поделиться в Telegram',
    btnCopyLink: '📋 Скопировать ссылку',
    btnRules: '📖 Правила',
  },
  en: {
    startNew:
      "👋 Welcome to Chapaev!\n\nKnock your opponent's checkers off the board — last one standing wins.\n\nTap Play to start.",
    startReturn: '👋 Welcome back! Ready to play?',
    play: '🎮 Tap the button below to start a game.',
    friends:
      '👥 I created a private room. Send this link to a friend so they can join the game:',
    friendsShareText: 'Play Chapaev with me? Join my room:',
    friendsError: 'Could not create a room. Please try again in a few seconds.',
    help:
      '📖 *Chapaev Rules*\n\n' +
      "• Goal: knock all your opponent's checkers off the board.\n" +
      '• Players take turns: tap your checker and flick it in a direction.\n' +
      "• You can't move the opponent's checkers directly.\n" +
      "• You win when none of the opponent's checkers remain on the board.",
    btnPlay: '🎮 Play',
    btnInvite: '👥 Invite a friend',
    btnShare: '📤 Share in Telegram',
    btnCopyLink: '📋 Copy link',
    btnRules: '📖 Rules',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof strings)['en'];

export function t(lang: Lang, key: StringKey): string {
  return strings[lang][key];
}
