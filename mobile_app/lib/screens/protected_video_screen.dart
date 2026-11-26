import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';
import '../widgets/watermark_overlay.dart';

/// مشغل فيديو محمي داخل التطبيق مع علامة مائية وترويسات المصادقة
class ProtectedVideoScreen extends StatefulWidget {
  final int lessonId;
  final String lessonTitle;
  final String videoType;
  final int initialPositionSeconds;

  const ProtectedVideoScreen({
    super.key,
    required this.lessonId,
    required this.lessonTitle,
    required this.videoType,
    this.initialPositionSeconds = 0,
  });

  @override
  State<ProtectedVideoScreen> createState() => _ProtectedVideoScreenState();
}

class _ProtectedVideoScreenState extends State<ProtectedVideoScreen> {
  bool _loading = true;
  String? _error;
  String _watermarkText = 'منصة مَتْن المحمية';
  String? _bunnyEmbedUrl;

  VideoPlayerController? _videoController;
  WebViewController? _webController;
  Timer? _progressTimer;
  Duration _lastSavedPos = Duration.zero;

  @override
  void initState() {
    super.initState();
    _initProtectedPlayer();
  }

  Future<void> _initProtectedPlayer() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final ticketRes = await MatnApiClient.requestVideoTicket(widget.lessonId);
      final ticket = ticketRes['ticket']?.toString() ?? '';
      final watermark = ticketRes['watermark_text']?.toString() ?? _watermarkText;
      final bunnyUrl = ticketRes['bunny_embed_url']?.toString();

      final headers = await MatnApiClient.buildMediaHeaders(streamTicket: ticket);

      if (bunnyUrl != null && bunnyUrl.isNotEmpty) {
        final webCtrl = WebViewController()
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Colors.black)
          ..loadRequest(Uri.parse(bunnyUrl));
        if (!mounted) return;
        setState(() {
          _watermarkText = watermark;
          _bunnyEmbedUrl = bunnyUrl;
          _webController = webCtrl;
          _loading = false;
        });
        return;
      }

      final streamUrl = '${MatnConfig.baseUrl}/api/stream/video/${widget.lessonId}';
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(streamUrl),
        httpHeaders: headers,
      );

      await controller.initialize();
      if (widget.initialPositionSeconds > 5 &&
          Duration(seconds: widget.initialPositionSeconds) < controller.value.duration) {
        await controller.seekTo(Duration(seconds: widget.initialPositionSeconds));
      }
      await controller.play();

      _progressTimer = Timer.periodic(const Duration(seconds: 12), (_) {
        _syncProgressIfNeeded();
      });

      if (!mounted) {
        await controller.dispose();
        return;
      }

      setState(() {
        _watermarkText = watermark;
        _videoController = controller;
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

  Future<void> _syncProgressIfNeeded() async {
    final c = _videoController;
    if (c == null || !c.value.isInitialized) return;
    final pos = c.value.position;
    final dur = c.value.duration;
    if (dur.inSeconds <= 0) return;
    if ((pos.inSeconds - _lastSavedPos.inSeconds).abs() < 4) return;
    _lastSavedPos = pos;
    try {
      await MatnApiClient.saveLessonProgress(widget.lessonId, pos.inSeconds, dur.inSeconds);
    } catch (_) {}
  }

  String _formatDuration(Duration d) {
    final totalSec = d.inSeconds;
    final h = totalSec ~/ 3600;
    final m = (totalSec % 3600) ~/ 60;
    final s = totalSec % 60;
    if (h > 0) {
      return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    _syncProgressIfNeeded();
    _videoController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavyDark,
          foregroundColor: Colors.white,
          title: Text(
            widget.lessonTitle,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: MatnConfig.kGold))
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
                          const SizedBox(height: 12),
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white, height: 1.5),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton.icon(
                            onPressed: _initProtectedPlayer,
                            icon: const Icon(Icons.refresh),
                            label: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  )
                : _bunnyEmbedUrl != null && _webController != null
                    ? Stack(
                        fit: StackFit.expand,
                        children: [
                          WebViewWidget(controller: _webController!),
                          WatermarkOverlay(watermarkText: _watermarkText, darkBackground: true),
                        ],
                      )
                    : _buildNativePlayer(),
      ),
    );
  }

  Widget _buildNativePlayer() {
    final controller = _videoController!;
    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        final durationSec = value.duration.inSeconds.toDouble().clamp(1.0, double.infinity);
        final posSec = value.position.inSeconds.toDouble().clamp(0.0, durationSec);

        return Column(
          children: [
            Expanded(
              child: Center(
                child: AspectRatio(
                  aspectRatio: value.aspectRatio > 0 ? value.aspectRatio : 16 / 9,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      VideoPlayer(controller),
                      WatermarkOverlay(watermarkText: _watermarkText, darkBackground: true),
                      if (value.isBuffering)
                        const Center(child: CircularProgressIndicator(color: MatnConfig.kGold)),
                    ],
                  ),
                ),
              ),
            ),
            Container(
              color: MatnConfig.kNavyDark,
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: Slider(
                      value: posSec,
                      min: 0,
                      max: durationSec,
                      activeColor: MatnConfig.kGold,
                      inactiveColor: Colors.white24,
                      onChanged: (v) {
                        controller.seekTo(Duration(seconds: v.toInt()));
                      },
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${_formatDuration(value.position)} / ${_formatDuration(value.duration)}',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      Row(
                        children: [
                          IconButton(
                            onPressed: () {
                              final next = value.position - const Duration(seconds: 10);
                              controller.seekTo(next < Duration.zero ? Duration.zero : next);
                            },
                            icon: const Icon(Icons.replay_10, color: Colors.white),
                          ),
                          IconButton(
                            iconSize: 36,
                            onPressed: () {
                              if (value.isPlaying) {
                                controller.pause();
                              } else {
                                controller.play();
                              }
                            },
                            icon: Icon(
                              value.isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled,
                              color: MatnConfig.kGold,
                            ),
                          ),
                          IconButton(
                            onPressed: () {
                              final next = value.position + const Duration(seconds: 10);
                              controller.seekTo(next > value.duration ? value.duration : next);
                            },
                            icon: const Icon(Icons.forward_10, color: Colors.white),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
