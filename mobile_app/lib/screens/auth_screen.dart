import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import '../services/api_service.dart';
import 'student_home_screen.dart';

class LoginRegisterScreen extends StatefulWidget {
  const LoginRegisterScreen({super.key});

  @override
  State<LoginRegisterScreen> createState() => _LoginRegisterScreenState();
}

class _LoginRegisterScreenState extends State<LoginRegisterScreen> {
  bool _isLogin = true;
  bool _otpStep = false;
  bool _busy = false;
  String? _error;
  String? _supportWhatsapp;
  String _registrationMode = 'whatsapp_otp';

  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _parentPhoneCtrl = TextEditingController();
  final _pwCtrl = TextEditingController();
  final _voucherCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();

  String _grade = 'grade_3';
  String _branch = 'scientific';

  @override
  void initState() {
    super.initState();
    _loadPublicInfo();
  }

  Future<void> _loadPublicInfo() async {
    try {
      final info = await MatnApiClient.fetchPublicInfo();
      final settings = (info['settings'] as Map<String, dynamic>?) ?? {};
      final wa = settings['support_whatsapp']?.toString().trim() ?? '';
      if (!mounted) return;
      setState(() {
        _supportWhatsapp = wa.isNotEmpty ? wa : null;
        _registrationMode = info['registration_mode']?.toString() ?? 'whatsapp_otp';
      });
    } catch (_) {}
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_isLogin) {
        final res = await MatnApiClient.post('/api/auth/login', {
          'phone': _phoneCtrl.text.trim(),
          'password': _pwCtrl.text,
        });
        await MatnApiClient.setToken(res['token'].toString());
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const StudentMobileHomeScreen()),
        );
        return;
      }

      if (_otpStep) {
        final res = await MatnApiClient.post('/api/auth/verify-otp', {
          'phone': _phoneCtrl.text.trim(),
          'otp_code': _otpCtrl.text.trim(),
        });
        await MatnApiClient.setToken(res['token'].toString());
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const StudentMobileHomeScreen()),
        );
        return;
      }

      final res = await MatnApiClient.post('/api/auth/register', {
        'full_name': _nameCtrl.text.trim(),
        'phone': _phoneCtrl.text.trim(),
        'parent_phone': _parentPhoneCtrl.text.trim(),
        'grade': _grade,
        'branch': MatnConfig.prepGrades.contains(_grade) ? 'general' : _branch,
        'password': _pwCtrl.text,
        if (_voucherCtrl.text.trim().isNotEmpty) 'activation_code': _voucherCtrl.text.trim(),
      });

      if (res['auto_verified'] == true && res['token'] != null) {
        await MatnApiClient.setToken(res['token'].toString());
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const StudentMobileHomeScreen()),
        );
        return;
      }

      setState(() {
        _otpStep = true;
      });
    } on MatnApiException catch (e) {
      setState(() => _error = e.message);
      if (e.payload['error_code'] == 'WHATSAPP_NOT_VERIFIED' || e.payload['requires_whatsapp_verification'] == true) {
        setState(() {
          _isLogin = false;
          _otpStep = true;
        });
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestDeviceReset() async {
    if (_phoneCtrl.text.trim().isEmpty || _pwCtrl.text.isEmpty) {
      setState(() => _error = 'أدخل رقم الهاتف وكلمة المرور أولاً لإرسال طلب فك ارتباط الجهاز.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await MatnApiClient.post('/api/auth/request-device-reset', {
        'phone': _phoneCtrl.text.trim(),
        'password': _pwCtrl.text,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res['message']?.toString() ?? 'تم إرسال الطلب للإدارة')),
      );
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openSupportWhatsapp() async {
    if (_supportWhatsapp == null) return;
    var clean = _supportWhatsapp!.replaceAll(RegExp(r'\D'), '');
    if (clean.startsWith('0') && clean.length == 11) {
      clean = '2$clean';
    }
    if (clean.isEmpty) return;
    final uri = Uri.parse('https://wa.me/$clean');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _parentPhoneCtrl.dispose();
    _pwCtrl.dispose();
    _voucherCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: MatnConfig.kBg,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(
                  children: [
                    Image.asset('assets/logo.png', height: 84),
                    const SizedBox(height: 10),
                    const Text(
                      'منصة مَتْن • الأستاذ محمد عبد الله',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: MatnConfig.kNavy),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'حماية محتوى نشطة ضد التصوير والتسجيل',
                      style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
                    ),
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: const [BoxShadow(color: Color(0x11000000), blurRadius: 16)],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: ChoiceChip(
                                  label: const Center(child: Text('تسجيل الدخول')),
                                  selected: _isLogin,
                                  onSelected: (_) => setState(() {
                                    _isLogin = true;
                                    _otpStep = false;
                                    _error = null;
                                  }),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: ChoiceChip(
                                  label: const Center(child: Text('حساب جديد')),
                                  selected: !_isLogin,
                                  onSelected: (_) => setState(() {
                                    _isLogin = false;
                                    _otpStep = false;
                                    _error = null;
                                  }),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          if (_error != null)
                            Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: MatnConfig.kRed.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(_error!, style: const TextStyle(color: MatnConfig.kRed, fontSize: 13)),
                            ),
                          if (!_isLogin && !_otpStep) ...[
                            TextField(
                              controller: _nameCtrl,
                              decoration: const InputDecoration(labelText: 'اسم الطالب رباعياً'),
                            ),
                            const SizedBox(height: 10),
                          ],
                          TextField(
                            controller: _phoneCtrl,
                            keyboardType: TextInputType.phone,
                            decoration: const InputDecoration(labelText: 'رقم هاتف الطالب (01...)'),
                          ),
                          const SizedBox(height: 10),
                          if (!_isLogin && !_otpStep) ...[
                            TextField(
                              controller: _parentPhoneCtrl,
                              keyboardType: TextInputType.phone,
                              decoration: const InputDecoration(labelText: 'رقم هاتف ولي الأمر'),
                            ),
                            const SizedBox(height: 10),
                            DropdownButtonFormField<String>(
                              value: _grade,
                              decoration: const InputDecoration(labelText: 'الصف الدراسي'),
                              items: MatnConfig.gradeLabels.entries
                                  .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                                  .toList(),
                              onChanged: (v) {
                                if (v != null) setState(() => _grade = v);
                              },
                            ),
                            if (!MatnConfig.prepGrades.contains(_grade)) ...[
                              const SizedBox(height: 10),
                              DropdownButtonFormField<String>(
                                value: _branch,
                                decoration: const InputDecoration(labelText: 'الشعبة'),
                                items: const [
                                  DropdownMenuItem(value: 'scientific', child: Text('القسم العلمي')),
                                  DropdownMenuItem(value: 'literary', child: Text('القسم الأدبي')),
                                ],
                                onChanged: (v) {
                                  if (v != null) setState(() => _branch = v);
                                },
                              ),
                            ],
                            const SizedBox(height: 10),
                            if (_registrationMode == 'voucher_code') ...[
                              TextField(
                                controller: _voucherCtrl,
                                decoration: const InputDecoration(labelText: 'كود التفعيل الشهري (إلزامي)'),
                              ),
                              const SizedBox(height: 10),
                            ],
                          ],
                          if (!_otpStep) ...[
                            TextField(
                              controller: _pwCtrl,
                              obscureText: true,
                              decoration: const InputDecoration(labelText: 'كلمة المرور'),
                            ),
                            const SizedBox(height: 14),
                          ] else ...[
                            TextField(
                              controller: _otpCtrl,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: 'رمز تفعيل واتساب (OTP)'),
                            ),
                            const SizedBox(height: 14),
                          ],
                          ElevatedButton(
                            onPressed: _busy ? null : _submit,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: MatnConfig.kNavy,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                            ),
                            child: _busy
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : Text(_isLogin
                                    ? 'دخول للمنصة'
                                    : (_otpStep ? 'تأكيد رمز التفعيل' : 'إنشاء الحساب')),
                          ),
                          if (_isLogin)
                            TextButton(
                              onPressed: _busy ? null : _requestDeviceReset,
                              child: const Text('طلب فك ارتباط الجهاز القديم', style: TextStyle(fontSize: 12)),
                            ),
                          if (_supportWhatsapp != null)
                            OutlinedButton.icon(
                              onPressed: _openSupportWhatsapp,
                              icon: const Icon(Icons.support_agent, size: 18),
                              label: const Text('تواصل مع الدعم الفني (واتساب)'),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
