import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';

class MatnApiException implements Exception {
  final String message;
  final int statusCode;
  final Map<String, dynamic> payload;

  MatnApiException(this.message, this.statusCode, [this.payload = const {}]);

  @override
  String toString() => message;
}

class MatnApiClient {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static const _tokenKey = 'matn_auth_token';
  static const _deviceIdKey = 'matn_device_id';

  static String? _cachedToken;
  static String? _cachedDeviceId;

  static Future<String> getOrCreateDeviceId() async {
    if (_cachedDeviceId != null && _cachedDeviceId!.isNotEmpty) {
      return _cachedDeviceId!;
    }
    try {
      final existing = await _storage.read(key: _deviceIdKey);
      if (existing != null && existing.length >= 12) {
        _cachedDeviceId = existing;
        return existing;
      }
    } catch (_) {}
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final rand = Random.secure();
    final suffix = List.generate(24, (_) => chars[rand.nextInt(chars.length)]).join();
    final id = 'matn_mob_${Platform.operatingSystem}_$suffix';
    _cachedDeviceId = id;
    try {
      await _storage.write(key: _deviceIdKey, value: id);
    } catch (_) {}
    return id;
  }

  static Future<String?> getToken() async {
    if (_cachedToken != null) return _cachedToken;
    try {
      _cachedToken = await _storage.read(key: _tokenKey);
    } catch (_) {
      _cachedToken = null;
    }
    return _cachedToken;
  }

  static Future<void> setToken(String token) async {
    _cachedToken = token;
    try {
      await _storage.write(key: _tokenKey, value: token);
    } catch (_) {}
  }

  static Future<void> clearToken() async {
    _cachedToken = null;
    try {
      await _storage.delete(key: _tokenKey);
    } catch (_) {}
  }

  static String deviceNameHeader() {
    final osLabel = Platform.isIOS ? 'iPhone/iPad (MATN App)' : 'Android (MATN App)';
    return Uri.encodeComponent(osLabel);
  }

  static Future<Map<String, String>> buildMediaHeaders({String? streamTicket}) async {
    final token = await getToken();
    final deviceId = await getOrCreateDeviceId();
    return <String, String>{
      'X-Device-Id': deviceId,
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      if (streamTicket != null && streamTicket.isNotEmpty) 'X-Stream-Ticket': streamTicket,
    };
  }

  static Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final token = await getToken();
    final deviceId = await getOrCreateDeviceId();

    final headers = <String, String>{
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Device-Name': deviceNameHeader(),
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };

    final uri = Uri.parse('${MatnConfig.baseUrl}$path');
    late http.Response res;
    if (method == 'GET') {
      res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 25));
    } else if (method == 'POST') {
      res = await http
          .post(uri, headers: headers, body: jsonEncode(body ?? {}))
          .timeout(const Duration(seconds: 25));
    } else if (method == 'PUT') {
      res = await http
          .put(uri, headers: headers, body: jsonEncode(body ?? {}))
          .timeout(const Duration(seconds: 25));
    } else {
      throw MatnApiException('طريقة الطلب غير مدعومة', 400);
    }

    Map<String, dynamic> decoded = {};
    try {
      if (res.body.isNotEmpty) {
        final raw = jsonDecode(res.body);
        if (raw is Map<String, dynamic>) decoded = raw;
      }
    } catch (_) {}

    if (res.statusCode >= 400) {
      if (res.statusCode == 401) {
        await clearToken();
      }
      throw MatnApiException(
        decoded['error']?.toString() ?? 'حدث خطأ في الاتصال (${res.statusCode})',
        res.statusCode,
        decoded,
      );
    }

    return decoded;
  }

  static Future<Map<String, dynamic>> get(String path) => request('GET', path);

  static Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) =>
      request('POST', path, body: body);

  static Future<Map<String, dynamic>> fetchPublicInfo() => get('/api/public/info');

  static Future<Map<String, dynamic>> fetchDashboard() => get('/api/student/dashboard');

  static Future<Map<String, dynamic>> requestVideoTicket(int lessonId) =>
      post('/api/media/ticket/$lessonId');

  static Future<Map<String, dynamic>> requestPdfMetadata(int lessonId) =>
      get('/api/stream/pdf/$lessonId');

  static Future<Map<String, dynamic>> saveLessonProgress(
    int lessonId,
    int positionSeconds,
    int durationSeconds,
  ) =>
      post('/api/lessons/$lessonId/progress', {
        'position_seconds': positionSeconds,
        'duration_seconds': durationSeconds,
      });

  static Future<Map<String, dynamic>> fetchNotifications() =>
      get('/api/student/notifications');

  static Future<Map<String, dynamic>> markNotificationsRead([List<int>? ids]) =>
      post('/api/student/notifications/read', {
        if (ids != null && ids.isNotEmpty) 'notification_ids': ids,
      });

  static Future<Map<String, dynamic>> fetchLiveSessions() =>
      get('/api/student/live-sessions');

  static Future<Map<String, dynamic>> joinLiveSession(int sessionId) =>
      post('/api/student/live-sessions/$sessionId/join');
}
