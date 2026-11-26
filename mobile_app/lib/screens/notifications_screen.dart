import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';

class NotificationsScreen extends StatefulWidget {
  final VoidCallback? onChanged;

  const NotificationsScreen({super.key, this.onChanged});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  String? _error;
  int _unreadCount = 0;
  List<dynamic> _notifications = [];

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
      final res = await MatnApiClient.fetchNotifications();
      if (!mounted) return;
      setState(() {
        _unreadCount = (res['unread_count'] as num?)?.toInt() ?? 0;
        _notifications = (res['notifications'] as List<dynamic>?) ?? [];
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

  Future<void> _markAllRead() async {
    try {
      final res = await MatnApiClient.markNotificationsRead();
      if (!mounted) return;
      setState(() {
        _unreadCount = (res['unread_count'] as num?)?.toInt() ?? 0;
        _notifications = (res['notifications'] as List<dynamic>?) ?? [];
      });
      widget.onChanged?.call();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: MatnConfig.kRed),
      );
    }
  }

  Future<void> _markSingleRead(int id) async {
    try {
      final res = await MatnApiClient.markNotificationsRead([id]);
      if (!mounted) return;
      setState(() {
        _unreadCount = (res['unread_count'] as num?)?.toInt() ?? 0;
        _notifications = (res['notifications'] as List<dynamic>?) ?? [];
      });
      widget.onChanged?.call();
    } catch (_) {}
  }

  IconData _iconForType(String type) {
    switch (type) {
      case 'new_lesson':
        return Icons.menu_book;
      case 'new_exam':
        return Icons.quiz;
      case 'live_session':
        return Icons.live_tv;
      case 'subscription_expiring':
        return Icons.warning_amber_rounded;
      default:
        return Icons.campaign;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: Text('الإشعارات ($_unreadCount غير مقروء)'),
          actions: [
            if (_unreadCount > 0)
              TextButton(
                onPressed: _markAllRead,
                child: const Text('تعليم الكل كمقروء', style: TextStyle(color: MatnConfig.kGoldSoft)),
              ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(child: Text(_error!, style: const TextStyle(color: MatnConfig.kRed)))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: _notifications.isEmpty
                        ? ListView(
                            children: const [
                              SizedBox(height: 120),
                              Center(child: Text('لا توجد إشعارات حتى الآن.')),
                            ],
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(14),
                            itemCount: _notifications.length,
                            itemBuilder: (_, i) {
                              final n = _notifications[i] as Map<String, dynamic>;
                              final isRead = n['is_read'] == true || n['is_read'] == 1;
                              final notifType = n['notif_type']?.toString() ?? 'announcement';
                              final id = (n['id'] as num?)?.toInt() ?? 0;
                              return Card(
                                color: isRead ? Colors.white : const Color(0xFFFFFBF0),
                                margin: const EdgeInsets.only(bottom: 10),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14),
                                  side: BorderSide(
                                    color: isRead ? Colors.grey.shade200 : MatnConfig.kGold,
                                    width: isRead ? 1 : 1.4,
                                  ),
                                ),
                                child: ListTile(
                                  onTap: !isRead && id > 0 ? () => _markSingleRead(id) : null,
                                  leading: CircleAvatar(
                                    backgroundColor: isRead
                                        ? Colors.grey.shade100
                                        : MatnConfig.kNavy.withOpacity(0.1),
                                    child: Icon(
                                      _iconForType(notifType),
                                      color: isRead ? Colors.grey : MatnConfig.kNavy,
                                    ),
                                  ),
                                  title: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          n['title']?.toString() ?? '',
                                          style: TextStyle(
                                            fontWeight: isRead ? FontWeight.w600 : FontWeight.bold,
                                            color: MatnConfig.kNavy,
                                          ),
                                        ),
                                      ),
                                      if (!isRead)
                                        Container(
                                          width: 9,
                                          height: 9,
                                          decoration: const BoxDecoration(
                                            color: MatnConfig.kRed,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                    ],
                                  ),
                                  subtitle: Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Text(
                                      n['body']?.toString() ?? '',
                                      style: const TextStyle(height: 1.5, color: Colors.black87),
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
      ),
    );
  }
}
