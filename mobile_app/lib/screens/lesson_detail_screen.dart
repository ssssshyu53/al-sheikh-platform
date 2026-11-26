import 'package:flutter/material.dart';

import '../config/app_config.dart';
import 'assessment_screens.dart';
import 'protected_pdf_screen.dart';
import 'protected_video_screen.dart';

class LessonDetailScreen extends StatelessWidget {
  final Map<String, dynamic> lesson;
  final VoidCallback onRefresh;

  const LessonDetailScreen({super.key, required this.lesson, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final assessments = (lesson['assessments'] as List<dynamic>?) ?? [];
    final progress = (lesson['progress'] as Map<String, dynamic>?) ?? {};
    final lastPos = (progress['last_position_seconds'] as num?)?.toInt() ?? 0;
    final lessonId = (lesson['id'] as num).toInt();
    final hasVideo = lesson['has_uploaded_video'] == true || lesson['bunny_video'] == true;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: Text(lesson['title']?.toString() ?? 'تفاصيل الحصة'),
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${MatnConfig.subjectLabel(lesson['subject']?.toString())} • ${lesson['unit_title'] ?? ''}',
                    style: const TextStyle(color: MatnConfig.kGold, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    lesson['title']?.toString() ?? '',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: MatnConfig.kNavy),
                  ),
                  if ((lesson['description']?.toString() ?? '').isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(lesson['description'].toString(), style: TextStyle(color: Colors.grey.shade700)),
                  ],
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      if (hasVideo)
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => ProtectedVideoScreen(
                                    lessonId: lessonId,
                                    lessonTitle: lesson['title']?.toString() ?? '',
                                    videoType: lesson['video_type']?.toString() ?? 'upload',
                                    initialPositionSeconds: lastPos,
                                  ),
                                ),
                              ).then((_) => onRefresh());
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: MatnConfig.kNavy,
                              foregroundColor: Colors.white,
                            ),
                            icon: const Icon(Icons.play_circle_fill),
                            label: const Text('مشاهدة الشرح (داخل التطبيق)'),
                          ),
                        ),
                      if (hasVideo) const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => ProtectedPdfScreen(
                                  lessonId: lessonId,
                                  title: lesson['pdf_title']?.toString() ?? 'المذكرة',
                                ),
                              ),
                            );
                          },
                          icon: const Icon(Icons.picture_as_pdf),
                          label: const Text('عرض المذكرة PDF'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'الواجبات والامتحانات',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: MatnConfig.kNavy),
            ),
            const SizedBox(height: 10),
            if (assessments.isEmpty)
              const Card(child: Padding(padding: EdgeInsets.all(14), child: Text('لا توجد اختبارات مضافة لهذه الحصة.')))
            else
              ...assessments.map((raw) {
                final a = raw as Map<String, dynamic>;
                final sub = a['latest_submission'] as Map<String, dynamic>?;
                final isExam = a['assessment_type'] != 'homework';

                return Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                a['title']?.toString() ?? '',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                              ),
                            ),
                            Text('${a['time_limit_minutes']} د', style: TextStyle(color: Colors.grey.shade600)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        if (sub != null && isExam) ...[
                          Text(
                            'الدرجة: ${sub['score']}/${sub['total_points']} (${sub['percentage']}%)',
                            style: TextStyle(
                              color: sub['passed'] == true || sub['passed'] == 1 ? MatnConfig.kGreen : MatnConfig.kRed,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (sub['review_allowed'] == true)
                            TextButton(
                              onPressed: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => AssessmentResultScreen(submissionId: (sub['id'] as num).toInt()),
                                  ),
                                );
                              },
                              child: const Text('عرض نموذج الإجابة والتعليل'),
                            ),
                        ] else
                          ElevatedButton(
                            onPressed: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => AssessmentQuizScreen(
                                    assessmentId: (a['id'] as num).toInt(),
                                    title: a['title']?.toString() ?? 'الاختبار',
                                  ),
                                ),
                              ).then((_) => onRefresh());
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: MatnConfig.kGold,
                              foregroundColor: MatnConfig.kNavyDark,
                            ),
                            child: Text(sub != null ? 'إعادة حل الواجب' : 'بدء الاختبار الآن'),
                          ),
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}
