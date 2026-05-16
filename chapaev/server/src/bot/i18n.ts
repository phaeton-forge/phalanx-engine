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
    btnFeedback: '✉️ Оставить отзыв',
    btnFeedbackBug: '🐛 Баг',
    btnFeedbackIdea: '💡 Идея',
    btnFeedbackReview: '❤️ Отзыв',
    btnCancel: '❌ Отмена',
    textGate:
      'Чат с ботом — только для игры 🎮\nЧтобы оставить отзыв — нажми кнопку ниже или /feedback.',
    feedbackCategoryPrompt: 'Что хочешь отправить?',
    feedbackMessagePrompt:
      'Напиши свой отзыв одним сообщением (3–2000 символов). Для отмены — /cancel.',
    feedbackLengthError:
      'Отзыв должен быть от 3 до 2000 символов. Напиши его одним сообщением или отправь /cancel.',
    feedbackThanks: 'Спасибо! 🙌 Отзыв отправлен.',
    feedbackCancelled: 'Отменено.',
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
    btnFeedback: '✉️ Leave feedback',
    btnFeedbackBug: '🐛 Bug',
    btnFeedbackIdea: '💡 Idea',
    btnFeedbackReview: '❤️ Review',
    btnCancel: '❌ Cancel',
    textGate:
      'Chat with the bot is only for the game 🎮\nTo leave feedback, tap the button below or use /feedback.',
    feedbackCategoryPrompt: 'What would you like to send?',
    feedbackMessagePrompt:
      'Write your feedback in one message (3-2000 characters). To cancel, use /cancel.',
    feedbackLengthError:
      'Feedback must be 3 to 2000 characters. Write it in one message or send /cancel.',
    feedbackThanks: 'Thanks! 🙌 Feedback sent.',
    feedbackCancelled: 'Cancelled.',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof strings)['en'];

export function t(lang: Lang, key: StringKey): string {
  return strings[lang][key];
}
