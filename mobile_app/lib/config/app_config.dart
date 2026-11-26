import 'package:flutter/material.dart';

class MatnConfig {
  /// غيّر هذا الرابط عند البناء للإنتاج باستخدام:
  /// flutter build apk --release --dart-define=MATN_API_BASE_URL=https://your-domain.com
  static const String baseUrl = String.fromEnvironment(
    'MATN_API_BASE_URL',
    defaultValue: 'https://your-domain.com',
  );

  static const Color kNavy = Color(0xFF103842);
  static const Color kNavyDark = Color(0xFF0A252C);
  static const Color kGold = Color(0xFFD0A33A);
  static const Color kGoldSoft = Color(0xFFF6E7BD);
  static const Color kBg = Color(0xFFF6F2EA);
  static const Color kCard = Colors.white;
  static const Color kGreen = Color(0xFF1E7E4E);
  static const Color kRed = Color(0xFFB3261E);

  static const Map<String, String> gradeLabels = {
    'prep_1': 'الأول الإعدادي الأزهري',
    'prep_2': 'الثاني الإعدادي الأزهري',
    'prep_3': 'الثالث الإعدادي الأزهري',
    'grade_1': 'الأول الثانوي الأزهري',
    'grade_2': 'الثاني الثانوي الأزهري',
    'grade_3': 'الثالث الثانوي الأزهري',
  };

  static const List<String> prepGrades = ['prep_1', 'prep_2', 'prep_3'];

  static const Map<String, String> branchLabels = {
    'scientific': 'القسم العلمي',
    'literary': 'القسم الأدبي',
    'general': 'المنهج الموحد',
  };

  static const Map<String, String> subjectLabels = {
    'fiqh': 'الفقه',
    'tafseer': 'التفسير',
    'hadith': 'الحديث',
    'tawheed': 'التوحيد',
    'seerah': 'السيرة',
    'tajweed': 'التجويد',
    'mawareeth': 'الميراث',
  };

  static List<String> subjectsForGrade(String grade) {
    if (grade == 'grade_3') {
      return const ['fiqh', 'hadith', 'tawheed', 'tafseer', 'mawareeth'];
    }
    if (prepGrades.contains(grade)) {
      return const ['fiqh', 'tafseer', 'hadith', 'tawheed', 'seerah', 'tajweed'];
    }
    return const ['fiqh', 'hadith', 'tawheed', 'tafseer'];
  }

  static String subjectLabel(String? s) => subjectLabels[s] ?? (s ?? '');
  static String gradeLabel(String? g) => gradeLabels[g] ?? (g ?? '');
  static String branchLabel(String? b) => branchLabels[b] ?? (b ?? '');
}
