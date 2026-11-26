import 'package:flutter/material.dart';
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';
import '../widgets/watermark_overlay.dart';

/// عارض مذكرات PDF المحمي داخل التطبيق مع العلامة المائية وترويسات المصادقة
class ProtectedPdfScreen extends StatefulWidget {
  final int lessonId;
  final String title;

  const ProtectedPdfScreen({
    super.key,
    required this.lessonId,
    required this.title,
  });

  @override
  State<ProtectedPdfScreen> createState() => _ProtectedPdfScreenState();
}

class _ProtectedPdfScreenState extends State<ProtectedPdfScreen> {
  bool _loading = true;
  String? _error;
  String _pdfTitle = '';
  String _watermarkText = 'منصة مَتْن المحمية';
  bool _hasBinaryPdf = false;
  bool _showStructuredFallback = false;
  Map<String, String> _pdfHeaders = const {};
  List<dynamic> _structuredPages = [];

  @override
  void initState() {
    super.initState();
    _loadPdfData();
  }

  Future<void> _loadPdfData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await MatnApiClient.requestPdfMetadata(widget.lessonId);
      final ticket = res['stream_ticket']?.toString() ?? '';
      final hasPdf = res['has_binary_pdf'] == true;
      final pages = (res['structured_pages'] as List<dynamic>?) ?? [];
      final headers = await MatnApiClient.buildMediaHeaders(streamTicket: ticket);

      if (!mounted) return;
      setState(() {
        _pdfTitle = res['pdf_title']?.toString() ?? widget.title;
        _watermarkText = res['watermark_text']?.toString() ?? _watermarkText;
        _hasBinaryPdf = hasPdf;
        _showStructuredFallback = !hasPdf && pages.isNotEmpty;
        _pdfHeaders = headers;
        _structuredPages = pages;
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
    final pdfFileUrl = '${MatnConfig.baseUrl}/api/stream/pdf-file/${widget.lessonId}';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: Text(
            _pdfTitle.isEmpty ? widget.title : _pdfTitle,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          actions: [
            if (_hasBinaryPdf && _structuredPages.isNotEmpty)
              TextButton.icon(
                onPressed: () {
                  setState(() => _showStructuredFallback = !_showStructuredFallback);
                },
                icon: Icon(
                  _showStructuredFallback ? Icons.picture_as_pdf : Icons.menu_book,
                  color: MatnConfig.kGoldSoft,
                  size: 18,
                ),
                label: Text(
                  _showStructuredFallback ? 'عرض PDF' : 'ملخص المذكرة',
                  style: const TextStyle(color: MatnConfig.kGoldSoft, fontSize: 12),
                ),
              ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: MatnConfig.kNavy))
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: MatnConfig.kRed)),
                          const SizedBox(height: 12),
                          ElevatedButton(
                            onPressed: _loadPdfData,
                            child: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  )
                : (!_hasBinaryPdf && _structuredPages.isEmpty)
                    ? const Center(child: Text('لا يوجد ملف PDF أو مذكرة مرفوعة لهذه المحاضرة.'))
                    : _showStructuredFallback || !_hasBinaryPdf
                        ? Stack(
                            children: [
                              _buildStructuredPages(),
                              WatermarkOverlay(watermarkText: _watermarkText, darkBackground: false),
                            ],
                          )
                        : Stack(
                            children: [
                              SfPdfViewer.network(
                                pdfFileUrl,
                                headers: _pdfHeaders,
                                canShowScrollHead: true,
                                canShowScrollStatus: true,
                              ),
                              WatermarkOverlay(watermarkText: _watermarkText, darkBackground: false),
                            ],
                          ),
      ),
    );
  }

  Widget _buildStructuredPages() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _structuredPages.length,
      itemBuilder: (_, i) {
        final page = _structuredPages[i] as Map<String, dynamic>;
        final matn = page['matn']?.toString() ?? '';
        final rawSharh = page['sharh'];
        final sharhList = rawSharh is List
            ? rawSharh.map((e) => e.toString()).where((s) => s.trim().isNotEmpty).toList()
            : (rawSharh is String && rawSharh.trim().isNotEmpty ? [rawSharh.trim()] : <String>[]);
        final notes = page['notes']?.toString() ?? '';
        final legacyBody = page['body']?.toString() ?? '';
        final points = (page['points'] as List<dynamic>?) ?? [];
        return Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                page['heading']?.toString() ?? 'صفحة ${i + 1}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: MatnConfig.kNavy,
                ),
              ),
              if (matn.isNotEmpty) ...[
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: MatnConfig.kGoldSoft.withOpacity(0.45),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: MatnConfig.kGold.withOpacity(0.5)),
                  ),
                  child: Text(
                    matn,
                    style: const TextStyle(
                      height: 1.8,
                      fontWeight: FontWeight.bold,
                      color: MatnConfig.kNavyDark,
                    ),
                  ),
                ),
              ],
              if (sharhList.isNotEmpty) ...[
                const SizedBox(height: 10),
                ...sharhList.map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      '• $line',
                      style: const TextStyle(height: 1.7, color: MatnConfig.kNavy),
                    ),
                  ),
                ),
              ],
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  'ملاحظة: $notes',
                  style: const TextStyle(
                    height: 1.6,
                    fontSize: 13,
                    color: MatnConfig.kGreen,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (legacyBody.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(legacyBody, style: const TextStyle(height: 1.7)),
              ],
              if (points.isNotEmpty) ...[
                const SizedBox(height: 10),
                ...points.map(
                  (pt) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '• $pt',
                      style: const TextStyle(color: MatnConfig.kGreen, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
