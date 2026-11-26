import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';
import '../widgets/watermark_overlay.dart';

class LiveSessionsTabView extends StatefulWidget {
  final String studentWatermark;

  const LiveSessionsTabView({super.key, required this.studentWatermark});

  @override
  State<LiveSessionsTabView> createState() => _LiveSessionsTabViewState();
}

class _LiveSessionsTabViewState extends State<LiveSessionsTabView> {
  bool _loading = true;
  String? _error;
  List<dynamic> _sessions = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await MatnApiClient.fetchLiveSessions();
      if (!mounted) return;
      setState(() {
        _sessions = (res['sessions'] as List<dynamic>?) ?? [];
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

  Future<void> _joinSession(Map<String, dynamic> session) async {
    final sessionId = (session['id'] as num).toInt();
    try {
      final res = await MatnApiClient.joinLiveSession(sessionId);
      final streamUrl = res['stream_url']?.toString() ?? '';
      if (streamUrl.isEmpty) {
        throw MatnApiException('رابط البث غير متاح حالياً.', 403);
      }
      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => InAppLiveStreamScreen(
            title: res['title']?.toString() ?? session['title']?.toString() ?? 'بث مباشر',
            streamUrl: streamUrl,
            watermarkText: widget.studentWatermark,
          ),
        ),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: MatnConfig.kRed),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, style: const TextStyle(color: MatnConfig.kRed)),
              const SizedBox(height: 10),
              ElevatedButton(onPressed: _load, child: const Text('تحديث')),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: _sessions.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 100),
                Center(child: Text('لا توجد حصص بث مباشر مجدولة لصفك حالياً.')),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.all(14),
              itemCount: _sessions.length,
              itemBuilder: (_, i) {
                final s = _sessions[i] as Map<String, dynamic>;
                final canJoin = s['can_join'] == true;
                final status = s['status']?.toString() ?? 'scheduled';
                final attended = s['attended'] == true;

                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: status == 'live' ? MatnConfig.kGreen : Colors.grey.shade200,
                      width: status == 'live' ? 1.5 : 1,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: status == 'live'
                                  ? MatnConfig.kGreen.withOpacity(0.12)
                                  : MatnConfig.kNavy.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(99),
                            ),
                            child: Text(
                              status == 'live'
                                  ? 'مباشر الآن 🔴'
                                  : status == 'ended'
                                      ? 'انتهى البث'
                                      : 'مجدولة',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: status == 'live' ? MatnConfig.kGreen : MatnConfig.kNavy,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            MatnConfig.subjectLabel(s['subject']?.toString()),
                            style: const TextStyle(color: MatnConfig.kGold, fontWeight: FontWeight.bold),
                          ),
                          const Spacer(),
                          if (attended)
                            const Icon(Icons.verified, color: MatnConfig.kGreen, size: 18),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        s['title']?.toString() ?? '',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: MatnConfig.kNavy,
                        ),
                      ),
                      if ((s['description']?.toString() ?? '').isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          s['description'].toString(),
                          style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                        ),
                      ],
                      const SizedBox(height: 10),
                      Text(
                        'المدة: ${s['duration_minutes']} دقيقة • ${s['starts_at']}',
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                      ),
                      const SizedBox(height: 12),
                      if (canJoin)
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            onPressed: () => _joinSession(s),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: MatnConfig.kGreen,
                              foregroundColor: Colors.white,
                            ),
                            icon: const Icon(Icons.live_tv),
                            label: const Text('دخول البث المباشر (داخل التطبيق)'),
                          ),
                        )
                      else
                        Text(
                          s['lock_reason']?.toString() ?? 'البث غير متاح للدخول الآن.',
                          style: const TextStyle(color: MatnConfig.kRed, fontSize: 12),
                        ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

class InAppLiveStreamScreen extends StatefulWidget {
  final String title;
  final String streamUrl;
  final String watermarkText;

  const InAppLiveStreamScreen({
    super.key,
    required this.title,
    required this.streamUrl,
    required this.watermarkText,
  });

  @override
  State<InAppLiveStreamScreen> createState() => _InAppLiveStreamScreenState();
}

class _InAppLiveStreamScreenState extends State<InAppLiveStreamScreen> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse(widget.streamUrl));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavyDark,
          foregroundColor: Colors.white,
          title: Text(widget.title, style: const TextStyle(fontSize: 15)),
        ),
        body: Stack(
          fit: StackFit.expand,
          children: [
            WebViewWidget(controller: _controller),
            WatermarkOverlay(watermarkText: widget.watermarkText, darkBackground: true),
          ],
        ),
      ),
    );
  }
}
