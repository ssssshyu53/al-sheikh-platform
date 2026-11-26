import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'screens/auth_screen.dart';
import 'screens/student_home_screen.dart';
import 'services/api_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MatnAlSheikhApp());
}

class MatnAlSheikhApp extends StatelessWidget {
  const MatnAlSheikhApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'منصة متن للمواد الشرعية',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: MatnConfig.kNavy,
        scaffoldBackgroundColor: MatnConfig.kBg,
        fontFamily: 'Roboto',
      ),
      home: const MatnAuthGate(),
    );
  }
}

class MatnAuthGate extends StatefulWidget {
  const MatnAuthGate({super.key});

  @override
  State<MatnAuthGate> createState() => _MatnAuthGateState();
}

class _MatnAuthGateState extends State<MatnAuthGate> {
  late Future<bool> _sessionFuture;

  @override
  void initState() {
    super.initState();
    _sessionFuture = _checkSession();
  }

  Future<bool> _checkSession() async {
    await MatnApiClient.getOrCreateDeviceId();
    final token = await MatnApiClient.getToken();
    if (token == null || token.isEmpty) return false;
    try {
      await MatnApiClient.get('/api/auth/me');
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: _sessionFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              backgroundColor: MatnConfig.kNavy,
              body: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: MatnConfig.kGold),
                    SizedBox(height: 16),
                    Text(
                      'منصة مَتْن للمواد الشرعية',
                      style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
        return snap.data == true ? const StudentMobileHomeScreen() : const LoginRegisterScreen();
      },
    );
  }
}
