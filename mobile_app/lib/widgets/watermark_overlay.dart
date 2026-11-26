import 'package:flutter/material.dart';

/// طبقة علامة مائية متكررة غير قابلة للتفاعل تُعرض فوق الفيديو والمذكرات والبث المباشر
class WatermarkOverlay extends StatelessWidget {
  final String watermarkText;
  final bool darkBackground;

  const WatermarkOverlay({
    super.key,
    required this.watermarkText,
    this.darkBackground = true,
  });

  @override
  Widget build(BuildContext context) {
    final text = watermarkText.trim().isEmpty ? 'منصة مَتْن المحمية' : watermarkText.trim();
    final color = darkBackground
        ? Colors.white.withOpacity(0.18)
        : const Color(0xFF103842).withOpacity(0.14);

    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final rows = (constraints.maxHeight / 120).ceil().clamp(2, 6);
          return Column(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(rows, (index) {
              return Transform.rotate(
                angle: -0.22,
                child: Padding(
                  padding: EdgeInsets.only(
                    left: index.isEven ? 12 : 48,
                    right: index.isOdd ? 12 : 48,
                  ),
                  child: Text(
                    text,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w800,
                      fontSize: 13,
                      letterSpacing: 0.4,
                    ),
                  ),
                ),
              );
            }),
          );
        },
      ),
    );
  }
}
