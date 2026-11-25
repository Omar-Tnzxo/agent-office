// Phrases for the sign-in page (login.html), and the language switch the pages before the office share.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {
  'login.title': 'Agent Office · Sign in',
  'login.langSwitch': 'Switch the language',
  'login.ask': "Knock knock. What's the password?",
  'login.askWho': 'Knock knock. Who is it?',
  'login.askWhoAccounts': 'Knock knock. Who is it? Sign in with your own account.',
  'login.name': 'Your name',
  'login.password': 'Password',
  'login.nameNote': 'Came in with the shared office password? Leave your name blank.',
  'login.submit': 'Come on in',
  'login.failed': 'Could not sign in',
} as const satisfies Strings;

export const ar: Arabic<typeof en> = {
  'login.title': 'Agent Office · تسجيل الدخول',
  'login.langSwitch': 'تغيير اللغة',
  'login.ask': 'طق طق. ما كلمة المرور؟',
  'login.askWho': 'طق طق. من الطارق؟',
  'login.askWhoAccounts': 'طق طق. من الطارق؟ سجّل الدخول بحسابك الخاص.',
  'login.name': 'اسمك',
  'login.password': 'كلمة المرور',
  'login.nameNote': 'دخلت بكلمة مرور المكتب المشتركة؟ اترك الاسم فارغًا.',
  'login.submit': 'تفضّل بالدخول',
  'login.failed': 'تعذّر تسجيل الدخول',
};
