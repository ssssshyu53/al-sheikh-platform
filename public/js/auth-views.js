import { SUBJECTS_META, GRADES_META } from './constants.js';

export function registerAuthMethods(proto) {
  Object.assign(proto, {
    renderNavbar() {
      const nav = document.getElementById('navActions');
      if (!nav) return;
      const supportWaUrl = this.formatSupportWaUrl('السلام عليكم، أريد الاستفسار عن الاشتراك في منصة متن');
      const themeBtn = `
        <button type="button" class="btn btn-outline-gold btn-sm nav-icon-toggle" data-click="toggleTheme" title="تبديل المظهر النهاري والليلي" aria-label="تبديل المظهر">
          ${this.icon(this.theme === 'dark' ? 'sun' : 'moon', 16)}
          <span class="nav-label-desktop">${this.theme === 'dark' ? 'النهاري' : 'الليلي'}</span>
        </button>
      `;

      if (!this.user) {
        nav.innerHTML = `
          ${themeBtn}
          <button type="button" class="btn btn-outline-gold btn-sm" data-click="openLoginModal">${this.icon('lock', 15)} <span>دخول</span></button>
          <button type="button" class="btn btn-gold btn-sm" data-click="openRegisterModal">${this.icon('user-check', 15)} <span>حساب جديد</span></button>
        `;
        return;
      }

      const unread = Number(this.notificationUnreadCount || 0);
      const roleMeta = this.user.role === 'admin'
        ? `<span class="nav-role-meta nav-desktop-only">${this.icon('crown', 14)} <span>لوحة الإدارة</span></span>`
        : `<span class="nav-role-meta nav-desktop-only ${this.user.subscription_active ? 'is-active' : 'is-expired'}">
             ${this.icon(this.user.subscription_active ? 'check-circle' : 'alert-triangle', 14)}
             <span>${this.user.subscription_active ? `مشترك · ${Number(this.user.days_remaining)} يوم` : 'غير مشترك'}</span>
           </span>`;

      nav.innerHTML = `
        ${roleMeta}
        ${themeBtn}
        ${this.user.role === 'student' ? `
          <button type="button" class="btn btn-outline-gold btn-sm nav-bell-btn" data-click="openNotificationsModal" title="الإشعارات" aria-label="الإشعارات">
            ${this.icon('bell', 16)}
            <span class="nav-label-desktop">إشعارات</span>
            ${unread > 0 ? `<span class="nav-notif-count">${unread}</span>` : ''}
          </button>
        ` : ''}
        ${this.user.role === 'student' && supportWaUrl ? `<a href="${this.esc(this.formatSupportWaUrl('السلام عليكم، أحتاج مساعدة في منصة متن'))}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm nav-desktop-only">${this.icon('message-circle', 15)} <span>الدعم</span></a>` : ''}
        ${this.user.role === 'student' ? `<button type="button" class="btn btn-gold btn-sm nav-desktop-only" data-click="openRedeemVoucherModal">${this.icon('ticket', 15)} <span>شحن كود</span></button>` : ''}
        <button type="button" class="btn btn-danger btn-sm nav-logout-btn" data-click="logout" title="تسجيل الخروج" aria-label="تسجيل الخروج">
          ${this.icon('logout', 16)}
          <span class="nav-label-desktop">خروج</span>
        </button>
      `;
    },

    renderDemoQuickAccessPanel(compact = false) {
      if (!this.demoAccounts) return '';
      const { student, admin } = this.demoAccounts;
      return `
        <div class="demo-access-panel ${compact ? 'is-compact' : ''}">
          <div class="demo-access-head">
            <span class="demo-access-title">
              ${this.icon('zap', 15)}
              <span>حسابات التجربة الفورية</span>
            </span>
            <span class="demo-access-hint">دخول مباشر بضغطة واحدة لتجربة كافة المزايا</span>
          </div>
          <div class="demo-access-grid">
            <button type="button" class="demo-account-btn demo-student-btn" data-click="demoLogin" data-arg="student">
              <span class="demo-btn-icon">${this.icon('graduation-cap', 18)}</span>
              <span class="demo-btn-text">
                <strong>دخول كطالب تجريبي</strong>
                <small dir="ltr">${this.esc(student.phone)} · ${this.esc(student.password)}</small>
              </span>
              <span class="demo-btn-arrow">${this.icon('arrow-left', 15)}</span>
            </button>
            <button type="button" class="demo-account-btn demo-admin-btn" data-click="demoLogin" data-arg="admin">
              <span class="demo-btn-icon">${this.icon('crown', 18)}</span>
              <span class="demo-btn-text">
                <strong>دخول كأدمن تجريبي</strong>
                <small dir="ltr">${this.esc(admin.phone)} · ${this.esc(admin.password)}</small>
              </span>
              <span class="demo-btn-arrow">${this.icon('arrow-left', 15)}</span>
            </button>
          </div>
        </div>
      `;
    },

    renderLanding() {
      this.currentView = 'landing';
      const root = document.getElementById('appRoot');
      const supportWaUrl = this.formatSupportWaUrl('السلام عليكم، أريد الاستفسار عن الاشتراك في منصة متن');
      const stats = this.publicStats || {};
      const hasStats = Number(stats.lessonsCount || 0) > 0 || Number(stats.examsCount || 0) > 0;

      root.innerHTML = `
        <div class="fade-in">
          <section class="hero-section">
            <div class="hero-content">
              <div class="hero-eyebrow">
                ${this.icon('landmark', 16)}
                <span>المرحلة الإعدادية الأزهرية · المرحلة الثانوية الأزهرية</span>
              </div>
              <h2 class="hero-title amiri-font">
                <span>${this.esc(this.publicSettings.platform_name || 'منصة مَتْن (MATN)')}</span><br/>
                بإشراف <span class="hero-title-accent">${this.esc(this.publicSettings.teacher_name || 'فضيلة الأستاذ محمد عبد الله')}</span>
              </h2>
              <p class="hero-subtitle">
                شرح تأصيلي ميسّر للعلوم الشرعية مع مذكرات منظمة، امتحانات إلكترونية بالتصحيح الفوري، وبنك أخطاء ذكي، ومتابعة أسبوعية لولي الأمر.
              </p>

              <div class="hero-cta-row">
                <button type="button" class="btn btn-gold" data-click="openRegisterModal">${this.icon('user-check', 17)} <span>ابدأ الآن — حساب طالب جديد</span></button>
                <button type="button" class="btn btn-outline-gold" data-click="openLoginModal">${this.icon('lock', 17)} <span>تسجيل الدخول</span></button>
                <button type="button" class="btn btn-ghost-subtle" data-click="openPlatformGuideVideoModal">${this.icon('play', 16)} <span>دليل المنصة بالفيديو</span></button>
              </div>

              ${hasStats ? `
                <div class="hero-metrics-strip">
                  <div class="hero-metric-item">
                    <strong>${Number(stats.lessonsCount || 0)}+</strong>
                    <span>محاضرة ومذكرة</span>
                  </div>
                  <span class="hero-metric-sep" aria-hidden="true"></span>
                  <div class="hero-metric-item">
                    <strong>${Number(stats.examsCount || 0)}+</strong>
                    <span>اختبار وواجب تفاعلي</span>
                  </div>
                  <span class="hero-metric-sep" aria-hidden="true"></span>
                  <div class="hero-metric-item">
                    <strong>٧</strong>
                    <span>مواد شرعية أزهرية</span>
                  </div>
                </div>
              ` : ''}

              ${this.renderDemoQuickAccessPanel(false)}
            </div>

            <div class="hero-logo-showcase">
              <div class="hero-logo-frame">
                <img src="/assets/logo.png" alt="منصة متن - الأستاذ محمد عبد الله" />
              </div>
            </div>
          </section>

          <div class="container">
            <section class="courses-section">
              <div class="courses-section-head">
                <div>
                  <h3 class="section-title">${this.icon('book-open', 20)} <span>الكورسات والمواد الشرعية</span></h3>
                  <p class="courses-section-sub">اختر المادة المناسبة لمرحلتك الدراسية وابدأ المذاكرة بالترتيب المنهجي</p>
                </div>
                <button type="button" class="btn btn-outline-gold btn-sm" data-click="openRegisterModal">${this.icon('ticket', 15)} <span>تفعيل كود اشتراك</span></button>
              </div>

              <div class="courses-grid">
                ${Object.entries(SUBJECTS_META).map(([, s]) => `
                  <article class="course-card">
                    <div class="course-card-banner">
                      <div class="course-card-icon">${this.icon(s.iconName || 'book', 22)}</div>
                      <span class="course-stage-caption">${this.esc(s.stage || 'أزهري')}</span>
                    </div>
                    <div class="course-card-body">
                      <h4 class="course-card-title">${this.esc(s.name)}</h4>
                      <p class="course-card-desc">${this.esc(s.desc)}</p>
                    </div>
                    <div class="course-card-footer">
                      <span class="course-instructor">${this.icon('award', 14)} <span>أ. محمد عبد الله</span></span>
                      <button type="button" class="course-cta-link" data-click="openLoginModal">
                        <span>ابدأ الكورس</span>
                        ${this.icon('arrow-left', 14)}
                      </button>
                    </div>
                  </article>
                `).join('')}
              </div>
            </section>

            <section class="section-card guide-showcase-card">
              <div class="guide-showcase-grid">
                <div>
                  <h3 class="section-title">${this.icon('video', 20)} <span>دليل التسجيل والمذاكرة في دقيقتين</span></h3>
                  <p class="section-subtitle-muted">
                    شاهد خطوات إنشاء الحساب، تفعيل الكود الشهري، وحل الامتحانات لفتح الدروس بالتتابع.
                  </p>
                  <div class="highlights-compact-list">
                    <div class="highlight-compact-item">${this.icon('shield-check', 18)} <span>حماية كاملة للمحتوى وربط بجهاز واحد</span></div>
                    <div class="highlight-compact-item">${this.icon('users', 18)} <span>تقارير متابعة أسبوعية لولي الأمر</span></div>
                    <div class="highlight-compact-item">${this.icon('award', 18)} <span>امتحانات على النظام الأزهري وبنك أخطاء</span></div>
                    <div class="highlight-compact-item">${this.icon('book-open', 18)} <span>مذكرات PDF منظمة على الهاتف والكمبيوتر</span></div>
                  </div>
                </div>
                <div class="guide-video-frame">
                  <video src="/assets/matn_guide_video.mp4" controls playsinline preload="metadata"></video>
                </div>
              </div>
            </section>

            <footer class="landing-footer">
              <span>جميع الحقوق محفوظة © ${this.esc(this.publicSettings.platform_name || 'منصة مَتْن (MATN)')}</span>
              <div class="landing-footer-actions">
                ${supportWaUrl ? `<a href="${this.esc(supportWaUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-gold">${this.icon('message-circle', 15)} <span>تواصل مع الدعم</span></a>` : ''}
                <button type="button" class="btn btn-sm btn-outline-gold" data-click="openPrivacyPolicyModal">${this.icon('lock', 15)} <span>سياسة الخصوصية</span></button>
              </div>
            </footer>
          </div>
        </div>
      `;
    },

    openPrivacyPolicyModal() {
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.1rem; display:flex; align-items:center; gap:8px;">${this.icon('lock', 18)} <span>سياسة الخصوصية وشروط الاستخدام — منصة مَتْن</span></h3>
          <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">${this.icon('x', 15)} <span>إغلاق</span></button>
        </div>
        <div style="font-size:0.86rem; color:var(--text-secondary); line-height:1.8; max-height:65vh; overflow-y:auto; padding-left:6px;">
          <h4 style="color:var(--gold-300); margin:8px 0 4px;">١. البيانات التي نجمعها</h4>
          <p>تجمع منصة مَتْن البيانات الضرورية فقط لتقديم الخدمة التعليمية لطلاب المرحلتين الإعدادية والثانوية الأزهرية، وتشمل: الاسم الرباعي للطالب، رقم هاتف الطالب، رقم هاتف ولي الأمر، الصف الدراسي، والشعبة الدراسية.</p>
          <h4 style="color:var(--gold-300); margin:10px 0 4px;">٢. الغرض من استخدام أرقام الهواتف</h4>
          <p>يُستخدم رقم هاتف الطالب لتأكيد الهوية عبر رمز التفعيل (OTP) وتسجيل الدخول، ويُستخدم رقم هاتف ولي الأمر لإرسال تقارير المتابعة الأكاديمية ودرجات الاختبارات ومواعيد امتحانات الإعادة.</p>
          <h4 style="color:var(--gold-300); margin:10px 0 4px;">٣. حماية البيانات وأمن الحساب</h4>
          <p>تُشفر كلمات المرور ورموز التحقق خادميًا باستخدام خوارزميات التشفير القياسية، ولا تُشارك بيانات الطلاب أو أولياء الأمور مع أي طرف ثالث لأغراض تجارية أو إعلانية.</p>
          <h4 style="color:var(--gold-300); margin:10px 0 4px;">٤. شروط الاستخدام وحقوق الملكية</h4>
          <p>الاشتراك شخصي لطالب واحد فقط؛ يُحظر نشر أو مشاركة الفيديوهات أو المذكرات خارج المنصة. تظهر علامة مائية باسم الطالب ورقم هاتفه كرادع لحفظ حقوق الملكية الفكرية.</p>
        </div>
      `, '640px');
    },

    openPlatformGuideVideoModal() {
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.05rem; display:flex; align-items:center; gap:8px;">${this.icon('video', 18)} <span>فيديو شرح التسجيل واستخدام منصة مَتْن</span></h3>
          <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">${this.icon('x', 15)} <span>إيقاف وإغلاق</span></button>
        </div>
        <div style="border:1px solid var(--border-gold); border-radius:14px; overflow:hidden; background:#000;">
          <video id="modalGuideVideo" src="/assets/matn_guide_video.mp4" controls autoplay playsinline style="width:100%; display:block; max-height:70vh;"></video>
        </div>
      `, '820px');
    },

    openLoginModal() {
      this.openModal(`
        <div style="text-align:center; margin-bottom:18px;">
          <img src="/assets/logo.png" alt="شعار منصة متن" style="width:60px; height:60px; border-radius:50%; border:2px solid var(--gold-400);" />
          <h3 style="color:var(--gold-400); margin-top:8px; font-size:1.22rem;">تسجيل الدخول إلى منصة مَتْن</h3>
          <p style="font-size:0.82rem; color:var(--text-secondary);">أدخل رقم الهاتف وكلمة المرور للمتابعة</p>
        </div>

        ${this.renderDemoQuickAccessPanel(true)}

        <form data-submit="handleLogin">
          <div class="form-group">
            <label for="loginPhone">رقم الهاتف</label>
            <input type="tel" id="loginPhone" class="form-control" placeholder="010xxxxxxxx" autocomplete="username" required />
          </div>
          <div class="form-group">
            <label for="loginPassword">كلمة المرور</label>
            <input type="password" id="loginPassword" class="form-control" placeholder="••••••••" autocomplete="current-password" required />
          </div>
          <div style="text-align:left; margin-bottom:12px;">
            <button type="button" class="btn btn-sm btn-outline-gold" data-click="openForgotPasswordModal">${this.icon('key', 14)} <span>نسيت كلمة المرور؟</span></button>
          </div>
          <div id="loginErrorBox" style="display:none; margin-bottom:14px;"></div>
          <button type="submit" id="loginSubmitBtn" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('lock', 16)} <span>دخول الآن</span></button>
        </form>

        <div class="card-meta-row" style="margin-top:16px; margin-bottom:0; padding-top:12px; border-top:1px solid var(--border-subtle);">
          <button type="button" class="btn btn-sm btn-outline-gold" data-click="openRegisterModal">طالب جديد؟ أنشئ حسابك</button>
          <button type="button" class="btn btn-sm btn-danger" data-click="closeModal">إغلاق</button>
        </div>
      `, '560px');
    },

    fillDemoLogin(role = 'student') {
      const acc = this.demoAccounts?.[role];
      if (!acc) return;
      const phoneEl = document.getElementById('loginPhone');
      const passEl = document.getElementById('loginPassword');
      if (phoneEl) phoneEl.value = acc.phone;
      if (passEl) passEl.value = acc.password;
    },

    async demoLogin(role = 'student', triggerBtn = null) {
      const acc = this.demoAccounts?.[role];
      if (!acc) {
        this.showToast('الحسابات التجريبية غير متاحة في وضع التشغيل الحالي.', 'warning');
        return;
      }
      if (triggerBtn) triggerBtn.disabled = true;
      try {
        const res = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ phone: acc.phone, password: acc.password })
        });
        this.csrfToken = res.csrf_token || this.getCookie('matn_csrf_token') || '';
        this.user = res.user;
        this.closeModal();
        this.renderNavbar();
        this.showToast(res.message || 'تم تسجيل الدخول بالحساب التجريبي بنجاح.', 'success');

        if (this.user.role === 'admin') {
          this.setHashRoute('/admin');
          await this.loadAdminDashboard(false);
        } else {
          this.setHashRoute('/dashboard');
          await this.loadStudentPortal(false);
        }
      } catch (err) {
        this.showToast(err.message || 'تعذر تسجيل الدخول بالحساب التجريبي.', 'danger');
      } finally {
        if (triggerBtn) triggerBtn.disabled = false;
      }
    },

    openForgotPasswordModal() {
      this.openModal(`
        <div style="text-align:center; margin-bottom:16px;">
          <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('key', 34)}</div>
          <h3 style="color:var(--gold-400);">استعادة كلمة المرور</h3>
          <p style="font-size:0.82rem; color:var(--text-secondary);">أدخل رقم هاتفك المسجل لإرسال رمز إعادة التعيين عبر الواتساب</p>
        </div>

        <form data-submit="handleForgotPassword">
          <div class="form-group">
            <label for="forgotPhone">رقم الهاتف المسجل</label>
            <input type="tel" id="forgotPhone" class="form-control" placeholder="010xxxxxxxx" required />
          </div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('smartphone', 16)} <span>إرسال كود الاستعادة</span></button>
        </form>

        <div class="card-meta-row" style="margin-top:14px; margin-bottom:0;">
          <button type="button" class="btn btn-sm btn-outline-gold" data-click="openLoginModal">${this.icon('arrow-right', 14)} <span>العودة لتسجيل الدخول</span></button>
          <button type="button" class="btn btn-sm btn-danger" data-click="closeModal">إغلاق</button>
        </div>
      `);
    },

    async handleForgotPassword(e) {
      e.preventDefault();
      const phone = this.normalizePhoneInput(document.getElementById('forgotPhone').value);
      try {
        const res = await this.api('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ phone })
        });
        this.showToast(res.message, 'success');
        this.openResetPasswordModal(phone);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openResetPasswordModal(phone) {
      const safePhone = this.esc(phone);
      this.openModal(`
        <div style="text-align:center; margin-bottom:14px;">
          <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('lock', 34)}</div>
          <h3 style="color:var(--gold-400);">تعيين كلمة مرور جديدة</h3>
          <p style="font-size:0.82rem; color:var(--text-secondary);">أدخل الرمز المرسل إلى <b>${safePhone}</b> وكلمة المرور الجديدة</p>
        </div>

        <form data-submit="handleResetPassword" data-arg="${safePhone}">
          <div class="form-group">
            <label for="resetOtpCode">رمز الاستعادة (٦ أرقام)</label>
            <input type="text" id="resetOtpCode" class="form-control" placeholder="••••••" maxlength="6" style="text-align:center; font-size:1.25rem; letter-spacing:4px;" required />
          </div>
          <div class="form-group">
            <label for="resetNewPassword">كلمة المرور الجديدة (٨ أحرف على الأقل)</label>
            <input type="password" id="resetNewPassword" class="form-control" minlength="8" required />
          </div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('check-circle', 16)} <span>حفظ كلمة المرور الجديدة</span></button>
        </form>
      `);
    },

    async handleResetPassword(e, phone) {
      e.preventDefault();
      const otp_code = this.normalizeDigits(document.getElementById('resetOtpCode').value).trim();
      const new_password = document.getElementById('resetNewPassword').value;
      try {
        const res = await this.api('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ phone: this.normalizePhoneInput(phone), otp_code, new_password })
        });
        this.showToast(res.message, 'success');
        this.openLoginModal();
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleLogin(e) {
      if (e && e.preventDefault) e.preventDefault();
      const phone = this.normalizePhoneInput(document.getElementById('loginPhone').value);
      const password = document.getElementById('loginPassword').value;
      const errBox = document.getElementById('loginErrorBox');
      const submitBtn = document.getElementById('loginSubmitBtn');
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ phone, password })
        });
        this.csrfToken = res.csrf_token || this.getCookie('matn_csrf_token') || '';
        this.user = res.user;
        this.closeModal();
        this.renderNavbar();
        this.showToast(res.message, 'success');

        if (this.user.role === 'admin') {
          this.setHashRoute('/admin');
          await this.loadAdminDashboard(false);
        } else {
          this.setHashRoute('/dashboard');
          await this.loadStudentPortal(false);
        }
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (err.data && err.data.error_code === 'WHATSAPP_NOT_VERIFIED') {
          this.showToast(err.data.error, 'warning');
          this.openOtpVerificationModal(err.data.phone || phone);
          return;
        }
        if (errBox) {
          errBox.style.display = 'block';
          if (err.data && err.data.error_code === 'DEVICE_LOCKED') {
            const waUrl = this.safeHttpsUrl(err.data.whatsapp_unlock_url, this.formatSupportWaUrl());
            errBox.innerHTML = `
              <div style="background:rgba(244,63,94,0.14); border:1px solid var(--danger); padding:12px; border-radius:12px;">
                <div style="font-weight:800; color:var(--danger-text); margin-bottom:6px; font-size:0.86rem;">${this.esc(err.data.error)}</div>
                <div style="font-size:0.78rem; color:var(--text-primary); margin-bottom:10px;">الجهاز المسجل: <b>${this.esc(err.data.registered_device)}</b></div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-outline-gold btn-sm" style="flex:1;" data-click="requestDeviceReset">
                    ${this.icon('refresh', 14)} <span>إرسال طلب إعادة تعيين الجهاز</span>
                  </button>
                  ${waUrl ? `<a href="${this.esc(waUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="flex:1;">${this.icon('message-circle', 14)} <span>تواصل مع الدعم</span></a>` : ''}
                </div>
              </div>
            `;
          } else {
            errBox.innerHTML = `<div style="background:rgba(244,63,94,0.14); border:1px solid var(--danger); color:var(--danger-text); padding:10px; border-radius:10px; font-weight:700; font-size:0.84rem;">${this.esc(err.message)}</div>`;
          }
        }
      }
    },

    async requestDeviceReset() {
      const phone = this.normalizePhoneInput(document.getElementById('loginPhone')?.value || '');
      const password = document.getElementById('loginPassword')?.value || '';
      try {
        const res = await this.api('/api/auth/request-device-reset', {
          method: 'POST',
          body: JSON.stringify({ phone, password })
        });
        this.showToast(res.message, 'success');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    renderPaymentChannelsBox() {
      const vf = String(this.publicSettings?.vodafone_cash_number || '').trim();
      const ip = String(this.publicSettings?.instapay_handle || '').trim();
      if (!vf && !ip) return '';
      return `
        <div style="background:rgba(16,185,129,0.08); border:1px solid var(--border-gold); border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:0.82rem;">
          <div style="font-weight:800; color:var(--gold-400); margin-bottom:8px; display:flex; align-items:center; gap:6px;">${this.icon('ticket', 16)} <span>أرقام التحويل الرسمية للاشتراك:</span></div>
          ${vf ? `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
              <span>• <b>فودافون كاش:</b> <span dir="ltr" style="color:var(--text-primary); font-weight:800;">${this.esc(vf)}</span></span>
              <button type="button" class="btn btn-outline-gold btn-sm" style="padding:4px 10px; font-size:0.74rem;" data-click="copyText" data-copy="${this.esc(vf)}" data-label="رقم فودافون كاش">${this.icon('copy', 13)} <span>نسخ</span></button>
            </div>
          ` : ''}
          ${ip ? `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <span>• <b>إنستا باي (InstaPay):</b> <span dir="ltr" style="color:var(--text-primary); font-weight:800;">${this.esc(ip)}</span></span>
              <button type="button" class="btn btn-outline-gold btn-sm" style="padding:4px 10px; font-size:0.74rem;" data-click="copyText" data-copy="${this.esc(ip)}" data-label="حساب إنستا باي">${this.icon('copy', 13)} <span>نسخ</span></button>
            </div>
          ` : ''}
        </div>
      `;
    },

    openRegisterModal() {
      const isVoucherMode = this.registrationMode === 'voucher_code';
      const isOtpMode = this.registrationMode === 'whatsapp_otp';
      this.openModal(`
        <div style="text-align:center; margin-bottom:14px;">
          <img src="/assets/logo.png" alt="شعار منصة متن" style="width:56px; height:56px; border-radius:50%; border:2px solid var(--gold-400);" />
          <h3 style="color:var(--gold-400); margin-top:6px; font-size:1.18rem;">إنشاء حساب طالب جديد</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary);">
            ${isOtpMode ? 'سيتم إرسال كود التفعيل إلى رقم الواتساب الخاص بك' : 'أدخل بياناتك وكود التفعيل الذي استلمته من الإدارة لفتح الحساب فوراً'}
          </p>
        </div>

        <form data-submit="handleRegister">
          <div class="form-group">
            <label for="regFullName">اسم الطالب رباعياً (٤ أسماء كاملة)</label>
            <input type="text" id="regFullName" class="form-control" placeholder="مثال: محمد أحمد عبد الله الشافعي" required />
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label for="regPhone">رقم هاتف الطالب</label>
              <input type="tel" id="regPhone" class="form-control" placeholder="010xxxxxxxx" required />
            </div>
            <div class="form-group">
              <label for="regParentPhone">رقم هاتف ولي الأمر</label>
              <input type="tel" id="regParentPhone" class="form-control" placeholder="010xxxxxxxx" required />
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label for="regGrade">الصف الدراسي الأزهري</label>
              <select id="regGrade" class="form-control" data-change="onRegGradeChange">
                ${this.renderGradeOptions('grade_3')}
              </select>
            </div>
            <div class="form-group">
              <label for="regBranch">الشعبة / المسار الدراسي</label>
              <select id="regBranch" class="form-control">
                <option value="scientific">القسم العلمي</option>
                <option value="literary">القسم الأدبي</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="regPassword">كلمة المرور (٨ أحرف أو أرقام على الأقل)</label>
            <input type="password" id="regPassword" class="form-control" placeholder="••••••••" minlength="8" required />
          </div>
          ${!isOtpMode ? `
            <div class="form-group">
              <label for="regActivationCode">كود التفعيل ${isVoucherMode ? '*' : '(اختياري)'}</label>
              <input type="text" id="regActivationCode" class="form-control" placeholder="MATN-DEMO-30D-001" style="text-align:center; font-weight:800; letter-spacing:1px;" ${isVoucherMode ? 'required' : ''} />
            </div>
          ` : ''}

          <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:12px;">
            بتسجيلك فإنك توافق على <button type="button" class="btn btn-sm btn-outline-gold" style="padding:2px 8px; font-size:0.74rem;" data-click="openPrivacyPolicyModal">سياسة الخصوصية وشروط الاستخدام</button>.
          </div>

          <div id="regErrorBox" style="display:none; margin-bottom:12px;"></div>

          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">
            ${this.icon(isOtpMode ? 'smartphone' : 'check-circle', 16)}
            <span>${isOtpMode ? 'تسجيل وإرسال كود الواتساب' : 'تسجيل وتفعيل الحساب الآن'}</span>
          </button>
        </form>

        ${!isOtpMode ? `
          <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border-gold);">
            <button type="button" class="btn btn-outline-gold btn-sm" style="width:100%;" data-click="toggleRequestCodePanel">
              ${this.icon('ticket', 15)} <span>ليس لديك كود تفعيل؟ حوّل واطلبه من الدعم الآن</span>
            </button>
            <div id="regRequestCodeBox" style="display:none; margin-top:10px; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:12px; padding:12px;">
              ${this.renderPaymentChannelsBox()}
              <div class="form-group" style="margin-bottom:8px;">
                <label for="regTransferNumber" style="font-size:0.78rem;">الرقم أو الحساب الذي حوّلت منه المبلغ</label>
                <input type="text" id="regTransferNumber" class="form-control" placeholder="اكتب رقم الهاتف أو حساب إنستا باي المحوَّل منه..." />
              </div>
              <button type="button" class="btn btn-whatsapp btn-sm" style="width:100%; padding:10px;" data-click="requestActivationCodeViaWhatsapp">
                ${this.icon('message-circle', 15)} <span>تواصل مع الدعم لطلب كود التفعيل</span>
              </button>
            </div>
          </div>
        ` : ''}

        <div class="card-meta-row" style="margin-top:14px; margin-bottom:0; padding-top:12px; border-top:1px solid var(--border-subtle);">
          <button type="button" class="btn btn-sm btn-outline-gold" data-click="openLoginModal">لديك حساب؟ سجل دخولك</button>
          <button type="button" class="btn btn-sm btn-danger" data-click="closeModal">إغلاق</button>
        </div>
      `, '590px');
    },

    toggleRequestCodePanel() {
      const box = document.getElementById('regRequestCodeBox');
      if (!box) return;
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    },

    requestActivationCodeViaWhatsapp() {
      const fullName = (document.getElementById('regFullName')?.value || '').trim();
      const phone = this.normalizeDigits(document.getElementById('regPhone')?.value || '').trim().replace(/\s+/g, '');
      const grade = document.getElementById('regGrade')?.value || 'grade_3';
      const gradeLabel = GRADES_META[grade] || grade;
      const transferNumber = this.normalizeDigits(document.getElementById('regTransferNumber')?.value || '').trim();

      if (!fullName) {
        this.showToast('يرجى كتابة اسمك في خانة الاسم بالأعلى أولاً.', 'warning');
        return;
      }
      if (!transferNumber) {
        this.showToast('يرجى كتابة رقم التحويل (الرقم الذي حوّلت منه) أولاً.', 'warning');
        return;
      }

      const msgLines = [
        'السلام عليكم ورحمة الله وبركاته',
        `أنا الطالب: ${fullName}`,
        `الصف: ${gradeLabel}`,
        'عاوز كود التفعيل',
        ...(phone ? [`رقم هاتف الحساب: ${phone}`] : []),
        `وده رقم التحويل: ${transferNumber}`
      ];
      const waUrl = this.safeHttpsUrl(this.formatSupportWaUrl(msgLines.join('\n')));
      if (!waUrl) {
        this.showToast('رقم واتساب الدعم غير مهيأ حالياً.', 'danger');
        return;
      }
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    },

    async handleRegister(e) {
      e.preventDefault();
      const full_name = document.getElementById('regFullName').value.trim();
      const phone = this.normalizePhoneInput(document.getElementById('regPhone').value);
      const parent_phone = this.normalizePhoneInput(document.getElementById('regParentPhone').value);
      const grade = document.getElementById('regGrade').value;
      const branch = document.getElementById('regBranch').value;
      const password = document.getElementById('regPassword').value;
      const activation_code = this.normalizeDigits(document.getElementById('regActivationCode')?.value || '').trim();
      const errBox = document.getElementById('regErrorBox');
      errBox.style.display = 'none';

      try {
        const res = await this.api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ full_name, phone, parent_phone, grade, branch, password, activation_code })
        });

        if (res.auto_verified === true && res.user) {
          this.csrfToken = res.csrf_token || this.getCookie('matn_csrf_token') || '';
          this.user = res.user;
          this.closeModal();
          this.renderNavbar();
          this.showToast(res.message || 'تم إنشاء حسابك وتفعيله بنجاح!', 'success');
          this.setHashRoute('/dashboard');
          await this.loadStudentPortal(false);
          return;
        }

        this.showToast(res.message, 'success');
        this.openOtpVerificationModal(phone);
      } catch (err) {
        errBox.style.display = 'block';
        errBox.innerHTML = `<div style="background:rgba(244,63,94,0.14); border:1px solid var(--danger); color:var(--danger-text); padding:10px; border-radius:10px; font-weight:700; font-size:0.84rem;">${this.esc(err.message)}</div>`;
      }
    },

    openOtpVerificationModal(phone) {
      const cleanPhone = this.normalizeDigits(phone).trim();
      const safePhone = this.esc(cleanPhone);
      const waAdminHelpUrl = this.formatSupportWaUrl(`السلام عليكم، أنا الطالب صاحب الرقم (${cleanPhone})، سجلت في منصة مَتْن وأحتاج لمساعدة في تفعيل الحساب.`);
      this.openModal(`
        <div style="text-align:center;">
          <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('smartphone', 34)}</div>
          <h3 style="color:var(--gold-400); margin-bottom:8px;">تأكيد الحساب عبر الواتساب</h3>
          <p style="font-size:0.86rem; color:var(--text-secondary); margin-bottom:16px;">
            أدخل كود التأكيد المكون من ٦ أرقام المرسل إلى رقم الواتساب <b>(${safePhone})</b>:
          </p>

          <form data-submit="handleVerifyOtp" data-arg="${safePhone}">
            <div class="form-group">
              <input
                type="text"
                id="otpInputCode"
                class="form-control"
                placeholder="••••••"
                maxlength="6"
                inputmode="numeric"
                autocomplete="one-time-code"
                style="text-align:center; font-size:1.35rem; font-weight:900; letter-spacing:6px;"
                required
              />
            </div>
            <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('check-circle', 16)} <span>تأكيد الكود وتفعيل الحساب</span></button>
          </form>

          <div class="card-meta-row" style="margin-top:16px; margin-bottom:0;">
            <button type="button" class="btn btn-outline-gold btn-sm" data-click="resendOtp" data-arg="${safePhone}">
              ${this.icon('refresh', 14)} <span>إعادة إرسال الكود (بعد ٦٠ ثانية)</span>
            </button>
            ${waAdminHelpUrl ? `<a href="${this.esc(waAdminHelpUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">${this.icon('message-circle', 14)} <span>تواصل مع الدعم</span></a>` : ''}
          </div>
        </div>
      `);
    },

    async resendOtp(phone) {
      try {
        const res = await this.api('/api/auth/resend-otp', {
          method: 'POST',
          body: JSON.stringify({ phone: this.normalizeDigits(phone).trim() })
        });
        this.showToast(res.message, 'success');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleVerifyOtp(e, phone) {
      e.preventDefault();
      const otp_code = this.normalizeDigits(document.getElementById('otpInputCode').value).trim();
      try {
        const res = await this.api('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ phone: this.normalizeDigits(phone).trim(), otp_code })
        });
        this.csrfToken = res.csrf_token || this.getCookie('matn_csrf_token') || '';
        this.user = res.user;
        this.closeModal();
        this.renderNavbar();
        this.showToast(res.message, 'success');
        this.setHashRoute('/dashboard');
        await this.loadStudentPortal(false);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openRedeemVoucherModal() {
      const waOrderUrl = this.formatSupportWaUrl(
        `السلام عليكم، أنا الطالب (${this.user ? this.user.full_name : ''}) بالصف (${this.user ? GRADES_META[this.user.grade] : ''})، أرغب في الحصول على كود اشتراك شهري (30 يوماً) في منصة مَتْن.`
      );

      this.openModal(`
        <div style="text-align:center; margin-bottom:16px;">
          <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('ticket', 34)}</div>
          <h3 style="color:var(--gold-400);">شحن كود الاشتراك الشهري (٣٠ يوماً)</h3>
          <p style="font-size:0.84rem; color:var(--text-secondary);">
            يفتح الكود محتوى المنصة لمدة <b>30 يوماً كاملة تبدأ من لحظة شحنك للكود</b>
          </p>
        </div>

        <form data-submit="handleRedeemVoucher">
          <div class="form-group">
            <label for="modalVoucherCodeInput">أدخل كود كارت الشحن</label>
            <input type="text" name="voucher_code" id="modalVoucherCodeInput" class="form-control" placeholder="MATN-DEMO-30D-001" style="text-align:center; font-size:1.15rem; font-weight:800; letter-spacing:1.5px;" required />
          </div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('zap', 16)} <span>تفعيل اشتراك ٣٠ يوماً الآن</span></button>
        </form>

        <div style="margin-top:12px;">
          ${this.renderPaymentChannelsBox()}
        </div>

        <div class="card-meta-row" style="margin-top:12px; margin-bottom:0; padding-top:12px; border-top:1px solid var(--border-subtle);">
          ${waOrderUrl ? `<a href="${this.esc(waOrderUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">${this.icon('message-circle', 15)} <span>طلب كود عبر الدعم</span></a>` : '<span></span>'}
          <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">إغلاق</button>
        </div>
      `);
    },

    async handleRedeemVoucher(e) {
      e.preventDefault();
      const inputEl = e.target ? e.target.querySelector('input[name="voucher_code"]') : null;
      const code = this.normalizeDigits((inputEl && inputEl.value) || '').trim();
      if (!code) {
        this.showToast('يرجى إدخال كود الشحن أولاً.', 'warning');
        return;
      }
      try {
        const res = await this.api('/api/vouchers/redeem', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        this.user = res.user;
        this.closeModal();
        this.renderNavbar();
        this.showToast(res.message, 'success');
        await this.loadStudentPortal(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    }
  });
}
