import UIKit
import Flutter

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
  private var privacyOverlay: UIView?
  private var securityChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    if let controller = self.window?.rootViewController as? FlutterViewController {
      securityChannel = FlutterMethodChannel(
        name: "com.matn.alsheikh/security",
        binaryMessenger: controller.binaryMessenger
      )
    }

    // رصد ومنع تسجيل الشاشة في نظام iOS (Screen Recording & AirPlay Shield)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleScreenCaptureChange),
      name: UIScreen.capturedDidChangeNotification,
      object: nil
    )

    let launched = super.application(application, didFinishLaunchingWithOptions: launchOptions)
    handleScreenCaptureChange()
    return launched
  }

  override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    handleScreenCaptureChange()
  }

  @objc private func handleScreenCaptureChange() {
    guard let window = self.window else { return }
    let captured = UIScreen.main.isCaptured
    securityChannel?.invokeMethod("screenCaptureChanged", arguments: ["captured": captured])

    if captured {
      if self.privacyOverlay == nil {
        let overlay = UIView(frame: window.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = UIColor(red: 0.04, green: 0.24, blue: 0.16, alpha: 1.0)
        let label = UILabel(frame: window.bounds)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        label.text = "🛡️ منصة مَتْن — يمنع تسجيل الشاشة لحماية المحتوى الشرعي"
        label.textColor = UIColor(red: 0.83, green: 0.70, blue: 0.42, alpha: 1.0)
        label.textAlignment = .center
        label.numberOfLines = 0
        overlay.addSubview(label)
        window.addSubview(overlay)
        self.privacyOverlay = overlay
      } else if let existing = self.privacyOverlay {
        existing.frame = window.bounds
        window.bringSubviewToFront(existing)
      }
    } else {
      self.privacyOverlay?.removeFromSuperview()
      self.privacyOverlay = nil
    }
  }
}
