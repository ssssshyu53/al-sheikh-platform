import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';
import 'auth_screen.dart';
import 'lesson_detail_screen.dart';
import 'live_sessions_screen.dart';
import 'notifications_screen.dart';

class StudentMobileHomeScreen extends StatefulWidget {
  const StudentMobileHomeScreen({super.key});

  @override
  State<StudentMobileHomeScreen> createState() => _StudentMobileHomeScreenState();
}

class _StudentMobileHomeScreenState extends State<StudentMobileHomeScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _data = {};
  int _tabIndex = 0;
  int _unreadNotifs = 0;
  String? _selectedSubject;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        MatnApiClient.fetchDashboard(),
        MatnApiClient.fetchNotifications().catchError((_) => <String, dynamic>{'unread_count': 0}),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0];
        _unreadNotifs = (results[1]['unread_count'] as num?)?.toInt() ?? 0;
        _loading = false;
      });
    } on MatnApiException catch (e) {
      if ((e.statusCode == 401 || (e.statusCode == 403 && e.payload['error_code'] == 'DEVICE_LOCKED')) && mounted) {
        await MatnApiClient.clearToken();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: MatnConfig.kRed),
        );
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const LoginRegisterScreen()),
          (_) => false,
        );
        return;
      }
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _showRedeemDialog() async {
    final codeCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('تفعيل كود اشتراك شهري'),
          content: TextField(
            controller: codeCtrl,
            decoration: const InputDecoration(hintText: 'أدخل كود الاشتراك (مثال: MATN-XXXX-XXXX)'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('إلغاء')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('تفعيل')),
          ],
        ),
      ),
    );
    if (ok != true || codeCtrl.text.trim().isEmpty) return;

    try {
      final res = await MatnApiClient.post('/api/vouchers/redeem', {'code': codeCtrl.text.trim()});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res['message']?.toString() ?? 'تم التفعيل بنجاح'), backgroundColor: MatnConfig.kGreen),
      );
      _loadDashboard();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()), backgroundColor: MatnConfig.kRed),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = (_data['user'] as Map<String, dynamic>?) ?? {};
    final lessons = (_data['lessons'] as List<dynamic>?) ?? [];
    final subjects = MatnConfig.subjectsForGrade(user['grade']?.toString() ?? 'grade_3');
    final watermark = '${user['full_name'] ?? ''} • ${user['phone'] ?? ''} • منصة مَتْن';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        appBar: AppBar(
          backgroundColor: MatnConfig.kNavy,
          foregroundColor: Colors.white,
          title: const Text('منصة مَتْن للمواد الشرعية'),
          actions: [
            Stack(
              alignment: Alignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.notifications_outlined),
                  onPressed: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => NotificationsScreen(onChanged: _loadDashboard),
                      ),
                    ).then((_) => _loadDashboard());
                  },
                ),
                if (_unreadNotifs > 0)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(color: MatnConfig.kRed, borderRadius: BorderRadius.circular(99)),
                      child: Text(
                        '$_unreadNotifs',
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
              ],
            ),
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () async {
                try {
                  await MatnApiClient.post('/api/auth/logout');
                } catch (_) {}
                await MatnApiClient.clearToken();
                if (!mounted) return;
                Navigator.pushAndRemoveUntil(
                  context,
                  MaterialPageRoute(builder: (_) => const LoginRegisterScreen()),
                  (_) => false,
                );
              },
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, style: const TextStyle(color: MatnConfig.kRed)),
                        const SizedBox(height: 10),
                        ElevatedButton(onPressed: _loadDashboard, child: const Text('إعادة المحاولة')),
                      ],
                    ),
                  )
                : IndexedStack(
                    index: _tabIndex,
                    children: [
                      _buildLessonsTab(user, subjects, lessons),
                      LiveSessionsTabView(studentWatermark: watermark),
                      _buildAccountTab(user),
                    ],
                  ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tabIndex,
          onDestinationSelected: (i) => setState(() => _tabIndex = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.menu_book), label: 'المحاضرات'),
            NavigationDestination(icon: Icon(Icons.live_tv), label: 'البث المباشر'),
            NavigationDestination(icon: Icon(Icons.person), label: 'حسابي'),
          ],
        ),
      ),
    );
  }

  Widget _buildLessonsTab(Map<String, dynamic> user, List<String> subjects, List<dynamic> lessons) {
    final filtered = _selectedSubject == null
        ? lessons
        : lessons.where((l) => (l as Map<String, dynamic>)['subject'] == _selectedSubject).toList();

    return RefreshIndicator(
      onRefresh: _loadDashboard,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [MatnConfig.kNavy, MatnConfig.kNavyDark]),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'أهلاً ${user['full_name'] ?? ''}',
                  style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                Text(
                  '${MatnConfig.gradeLabel(user['grade']?.toString())} • ${MatnConfig.branchLabel(user['branch']?.toString())}',
                  style: const TextStyle(color: MatnConfig.kGoldSoft, fontSize: 12),
                ),
                const SizedBox(height: 10),
                ElevatedButton.icon(
                  onPressed: _showRedeemDialog,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: MatnConfig.kGold,
                    foregroundColor: MatnConfig.kNavyDark,
                  ),
                  icon: const Icon(Icons.qr_code, size: 18),
                  label: const Text('تفعيل كود اشتراك'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: ChoiceChip(
                    label: const Text('كل المواد'),
                    selected: _selectedSubject == null,
                    onSelected: (_) => setState(() => _selectedSubject = null),
                  ),
                ),
                ...subjects.map(
                  (sub) => Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: ChoiceChip(
                      label: Text(MatnConfig.subjectLabel(sub)),
                      selected: _selectedSubject == sub,
                      onSelected: (_) => setState(() => _selectedSubject = sub),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (filtered.isEmpty)
            const Card(child: Padding(padding: EdgeInsets.all(18), child: Text('لا توجد محاضرات متاحة حالياً.')))
          else
            ...filtered.map((raw) {
              final l = raw as Map<String, dynamic>;
              final unlocked = l['unlocked'] == true;
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                child: ListTile(
                  onTap: () {
                    if (!unlocked) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(l['lock_reason']?.toString() ?? 'هذه المحاضرة مغلقة')),
                      );
                      return;
                    }
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => LessonDetailScreen(lesson: l, onRefresh: _loadDashboard),
                      ),
                    );
                  },
                  leading: CircleAvatar(
                    backgroundColor: unlocked ? MatnConfig.kNavy.withOpacity(0.1) : Colors.grey.shade200,
                    child: Icon(
                      unlocked ? Icons.play_arrow : Icons.lock,
                      color: unlocked ? MatnConfig.kNavy : Colors.grey,
                    ),
                  ),
                  title: Text(l['title']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text(
                    unlocked
                        ? '${MatnConfig.subjectLabel(l['subject']?.toString())} • ${l['duration_minutes'] ?? 0} دقيقة'
                        : (l['lock_reason']?.toString() ?? 'مغلقة'),
                    style: TextStyle(color: unlocked ? Colors.grey.shade700 : MatnConfig.kRed, fontSize: 12),
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildAccountTab(Map<String, dynamic> user) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(user['full_name']?.toString() ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('الهاتف: ${user['phone'] ?? ''}'),
                Text('هاتف ولي الأمر: ${user['parent_phone'] ?? ''}'),
                Text('الصف: ${MatnConfig.gradeLabel(user['grade']?.toString())}'),
                Text('الاشتراك حتى: ${user['subscription_expires_at'] ?? 'غير مفعل'}'),
                const SizedBox(height: 12),
                ElevatedButton(
                  onPressed: _showRedeemDialog,
                  child: const Text('تفعيل كود اشتراك جديد'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
