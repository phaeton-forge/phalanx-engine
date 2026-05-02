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
      '👥 Пригласи друзей по своей реферальной ссылке:',
    help:
      '📖 *Правила Чапаева*\n\n' +
      '• Цель — выбить все шашки соперника за пределы доски.\n' +
      '• Ходят по очереди: щёлкни по своей шашке и тяни в нужном направлении.\n' +
      '• Нельзя двигать шашки соперника напрямую.\n' +
      '• Выигрывает тот, у кого на доске не останется шашек соперника.',
    btnPlay: '🎮 Играть',
    btnInvite: '👥 Пригласить друга',
    btnRules: '📖 Правила',
  },
  en: {
    startNew:
      "👋 Welcome to Chapaev!\n\nKnock your opponent's checkers off the board — last one standing wins.\n\nTap Play to start.",
    startReturn: '👋 Welcome back! Ready to play?',
    play: '🎮 Tap the button below to start a game.',
    friends: '👥 Invite friends with your referral link:',
    help:
      '📖 *Chapaev Rules*\n\n' +
      "• Goal: knock all your opponent's checkers off the board.\n" +
      '• Players take turns: tap your checker and flick it in a direction.\n' +
      "• You can't move the opponent's checkers directly.\n" +
      "• You win when none of the opponent's checkers remain on the board.",
    btnPlay: '🎮 Play',
    btnInvite: '👥 Invite a friend',
    btnRules: '📖 Rules',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof strings)['en'];

export function t(lang: Lang, key: StringKey): string {
  return strings[lang][key];
}
