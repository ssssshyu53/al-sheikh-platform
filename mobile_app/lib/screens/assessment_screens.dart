import 'dart:async';

import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';

class AssessmentQuizScreen extends StatefulWidget {
  final int assessmentId;
  final String title;

  const AssessmentQuizScreen({super.key, required this.assessmentId, required this.title});

  @override
  State<AssessmentQuizScreen> createState() => _AssessmentQuizScreenState();
}

class _AssessmentQuizScreenState extends State<AssessmentQuizScreen> {
  bool _loading = true;
  bool _submitting = false;
  String? _error;
  List<dynamic> _questions = [];
  final Map<int, String> _answers = {};
  int _remainingSeconds = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startAssessment();
  }

  Future<void> _startAssessment() async {
    try {
      final res = await MatnApiClient.get('/api/assessments/${widget.assessmentId}/start');
      final meta = (res['assessment'] as Map<String, dynamic>?) ?? res;
      final remaining = (meta['remaining_seconds'] as num?)?.toInt() ??
          (((meta['time_limit_minutes'] as num?)?.toInt() ?? 15) * 60);

      if (!mounted) return;
      setState(() {
        _questions = (res['questions'] as List<dynamic>?) ?? [];
        _remainingSeconds = remaining;
        _loading = false;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return;
        if (_remainingSeconds <= 1) {
          t.cancel();
          _submitQuiz(autoSubmitted: true);
        } else {
          setState(() => _remainingSeconds--);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _submitQuiz({bool autoSubmitted = false}) async {
    if (_submitting) return;
    setState(() => _submitting = true);
    _timer?.cancel();
    try {
      final serialized = <String, String>{};
      _answers.forEach((k, v) => serialized[k.toString()] = v);
      final res = await MatnApiClient.post('/api/assessments/${widget.assessmentId}/submit', {
        'answers': serialized,
        if (autoSubmitted) 'auto_submitted': true,
      });
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => AssessmentResultScreen(resultData: res)),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _submitting = false;
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mins = (_remainingSeconds ~/ 60).toString().padLeft(2, '0');
    final secs = (_remainingSeconds % 60).toString().padLeft(2, '0');

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: Text(widget.title, style: const TextStyle(fontSize: 15)),
          actions: [
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Text(
                  '$mins:$secs',
                  style: const TextStyle(color: MatnConfig.kGoldSoft, fontWeight: FontWeight.bold),
                ),
              ),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)))
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      ..._questions.asMap().entries.map((entry) {
                        final idx = entry.key;
                        final q = entry.value as Map<String, dynamic>;
                        final qId = (q['id'] as num).toInt();
                        final opts = (q['options'] as List<dynamic>?) ?? [];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${idx + 1}. ${q['question_text']}',
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                                ),
                                const SizedBox(height: 8),
                                ...opts.map((opt) {
                                  final val = opt.toString();
                                  return RadioListTile<String>(
                                    value: val,
                                    groupValue: _answers[qId],
                                    onChanged: (v) {
                                      if (v != null) setState(() => _answers[qId] = v);
                                    },
                                    title: Text(val),
                                  );
                                }),
                              ],
                            ),
                          ),
                        );
                      }),
                      ElevatedButton(
                        onPressed: _submitting ? null : () => _submitQuiz(),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: MatnConfig.kGreen,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        child: Text(_submitting ? 'جاري التسليم...' : 'تسليم الإجابات'),
                      ),
                    ],
                  ),
      ),
    );
  }
}

class AssessmentResultScreen extends StatefulWidget {
  final Map<String, dynamic>? resultData;
  final int? submissionId;

  const AssessmentResultScreen({super.key, this.resultData, this.submissionId});

  @override
  State<AssessmentResultScreen> createState() => _AssessmentResultScreenState();
}

class _AssessmentResultScreenState extends State<AssessmentResultScreen> {
  Map<String, dynamic>? _data;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.resultData != null) {
      _data = widget.resultData;
    } else if (widget.submissionId != null) {
      _loadReview();
    }
  }

  Future<void> _loadReview() async {
    setState(() => _loading = true);
    try {
      final res = await MatnApiClient.get('/api/submissions/${widget.submissionId}/review');
      if (!mounted) return;
      setState(() {
        _data = res;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final review = (data?['detailed_review'] as List<dynamic>?) ?? [];
    final passed = data?['passed'] == true || data?['passed'] == 1;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: const Text('نتيجة ومراجعة الاختبار'),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)))
                : ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        color: passed ? const Color(0xFFECFDF3) : const Color(0xFFFEF2F2),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            children: [
                              Text(
                                'الدرجة: ${data?['score'] ?? 0} / ${data?['total_points'] ?? 0} (${data?['percentage'] ?? 0}%)',
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                              if (data?['message'] != null) ...[
                                const SizedBox(height: 8),
                                Text(data!['message'].toString(), textAlign: TextAlign.center),
                              ],
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      ...review.map((item) {
                        final r = item as Map<String, dynamic>;
                        final ok = r['is_correct'] == true;
                        return Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  r['question_text']?.toString() ?? '',
                                  style: const TextStyle(fontWeight: FontWeight.bold),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'إجابتك: ${r['selected_option']}',
                                  style: TextStyle(color: ok ? MatnConfig.kGreen : MatnConfig.kRed),
                                ),
                                if (!ok)
                                  Text(
                                    'الصحيح: ${r['correct_option']}',
                                    style: const TextStyle(color: MatnConfig.kGreen),
                                  ),
                                if ((r['explanation']?.toString() ?? '').isNotEmpty)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text(
                                      'التعليل: ${r['explanation']}',
                                      style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
                                    ),
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
