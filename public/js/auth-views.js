import { SUBJECTS_META, GRADES_META } from './constants.js';

const COURSE_STAGE_GROUPS = {
  fiqh: ['prep', 'sec'],
  tafseer: ['prep', 'sec'],
  hadith: ['prep', 'sec'],
  tawheed: ['prep', 'sec'],
  seerah: ['prep'],
  tajweed: ['prep'],
  mawareeth: ['sec']
};

const COURSE_SYLLABUS_META = {
  fiqh: 'فقه العبادات والمعاملات والأحوال الشخصية',
  tafseer: 'تفسير السور المقررة والأسرار البلاغية',
  hadith: 'شرح الأحاديث النبوية وتراجم الرواة',
  tawheed: 'الإلهيات والنبوات والسمعيات الأزهرية',
  seerah: 'الغزوات والدروس التربوية للمرحلة الإعدادية',
  tajweed: 'أحكام التلاوة والمخارج والصفات بالتطبيق',
  mawareeth: 'أصحاب الفروض والعصبات وحل المسائل'
};

const ARABIC_INDEX = ['٠١', '٠٢', '٠٣', '٠٤', '٠٥', '٠٦', '٠٧', '٠٨'];

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
        const isLogin = this.currentView === 'login';
        const isRegister = this.currentView === 'register';
        nav.innerHTML = `
          ${themeBtn}
          <button type="button" class="btn ${isLogin ? 'btn-gold' : 'btn-outline-gold'} btn-sm nav-auth-btn" data-click="openLoginModal">${this.icon('log-in', 15)} <span>دخول</span></button>
          <button type="button" class="btn ${isRegister ? 'btn-emerald' : 'btn-gold'} btn-sm nav-auth-btn" data-click="openRegisterModal">${this.icon('user-check', 15)} <span class="nav-reg-full">حساب جديد</span><span class="nav-reg-short">تسجيل</span></button>
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
        <button type="button" class="btn btn-outline-gold btn-sm nav-mobile-menu-btn" data-click="toggleMobileSidebar" title="القائمة الجانبية" aria-label="فتح القائمة الجانبية">
          ${this.icon('menu', 17)}
        </button>
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
      this.renderNavbar();
      const root = document.getElementById('appRoot');
      const supportWaUrl = this.formatSupportWaUrl('السلام عليكم، أريد الاستفسار عن الاشتراك في منصة متن');
      const stats = this.publicStats || {};
      const hasStats = Number(stats.lessonsCount || 0) > 0 || Number(stats.examsCount || 0) > 0;
      const teacherDisplay = String(this.publicSettings.teacher_name || 'فضيلة الأستاذ محمد عبد الله').replace(/عبد\s+الله/g, 'عبد\u00A0الله');
      const stageFilter = this.landingCourseStage || 'all';

      const allCourses = Object.entries(SUBJECTS_META);
      const filteredCourses = allCourses.filter(([key]) => {
        if (stageFilter === 'all') return true;
        return (COURSE_STAGE_GROUPS[key] || []).includes(stageFilter);
      });

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
                بإشراف <span class="hero-title-accent">${this.esc(teacherDisplay)}</span>
              </h2>
              <p class="hero-subtitle">
                شرح تأصيلي ميسّر للعلوم الشرعية مع مذكرات منظمة، امتحانات إلكترونية بالتصحيح الفوري، وبنك أخطاء ذكي، ومتابعة أسبوعية لولي الأمر.
              </p>

              <div class="hero-cta-row">
                <button type="button" class="btn btn-gold" data-click="openRegisterModal">${this.icon('user-check', 17)} <span>ابدأ الآن — حساب طالب جديد</span></button>
                <button type="button" class="btn btn-outline-gold" data-click="openLoginModal">${this.icon('log-in', 16)} <span>تسجيل الدخول</span></button>
                <button type="button" class="btn btn-ghost-subtle" data-click="openPlatformGuideVideoModal">${this.icon('play', 15)} <span>دليل الفيديو</span></button>
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
            <section class="pillars-strip" aria-label="مميزات منصة متن">
              <div class="pillar-item">
                <div class="pillar-icon">${this.icon('shield-check', 20)}</div>
                <div>
                  <h4>حماية متكاملة للمحتوى</h4>
                  <p>بث مؤمّن وربط بجهاز واحد وعلامة مائية لحفظ الحقوق.</p>
                </div>
              </div>
              <div class="pillar-item">
                <div class="pillar-icon">${this.icon('award', 20)}</div>
                <div>
                  <h4>امتحانات وبنك أخطاء ذكي</h4>
                  <p>تصحيح فوري على النظام الأزهري مع مراجعة تلقائية للأخطاء.</p>
                </div>
              </div>
              <div class="pillar-item">
                <div class="pillar-icon">${this.icon('book-open', 20)}</div>
                <div>
                  <h4>مذكرات PDF منظمة</h4>
                  <p>قراءة واضحة للمتون والشرح على الهاتف والكمبيوتر.</p>
                </div>
              </div>
              <div class="pillar-item">
                <div class="pillar-icon">${this.icon('users', 20)}</div>
                <div>
                  <h4>متابعة أسبوعية لولي الأمر</h4>
                  <p>تقارير منتظمة بمستوى الطالب وحضوره ودرجات اختبارات الأسبوع.</p>
                </div>
              </div>
            </section>

            <section class="courses-section" id="coursesCatalog">
              <div class="courses-section-head">
                <div>
                  <h3 class="section-title">${this.icon('book-open', 20)} <span>الكورسات والمواد الشرعية</span></h3>
                  <p class="courses-section-sub">منهج أزهري متكامل ومقسّم بوضوح لكل مرحلة دراسية</p>
                </div>

                <div class="courses-stage-tabs" role="tablist" aria-label="تصفية المواد حسب المرحلة">
                  <button type="button" class="stage-filter-btn ${stageFilter === 'all' ? 'active' : ''}" data-click="filterLandingCourses" data-arg="all">الكل (${allCourses.length})</button>
                  <button type="button" class="stage-filter-btn ${stageFilter === 'sec' ? 'active' : ''}" data-click="filterLandingCourses" data-arg="sec">الثانوية الأزهرية</button>
                  <button type="button" class="stage-filter-btn ${stageFilter === 'prep' ? 'active' : ''}" data-click="filterLandingCourses" data-arg="prep">الإعدادية الأزهرية</button>
                </div>
              </div>

              <div class="courses-grid">
                ${filteredCourses.map(([key, s], idx) => `
                  <article class="course-card">
                    <div class="course-card-top">
                      <div class="course-card-icon">${this.icon(s.iconName || 'book', 21)}</div>
                      <div class="course-card-meta-right">
                        <span class="course-index">${ARABIC_INDEX[idx] || String(idx + 1)}</span>
                        <span class="course-stage-caption">${this.esc(s.stage || 'أزهري')}</span>
                      </div>
                    </div>
                    <div class="course-card-body">
                      <h4 class="course-card-title">${this.esc(s.name)}</h4>
                      <p class="course-card-desc">${this.esc(s.desc)}</p>
                      <div class="course-card-syllabus">
                        <span>${this.esc(COURSE_SYLLABUS_META[key] || 'شرح منهجي ومذكرات واختبارات')}</span>
                      </div>
                    </div>
                    <div class="course-card-footer">
                      <span class="course-instructor">${this.icon('award', 14)} <span>أ. محمد عبد\u00A0الله</span></span>
                      <button type="button" class="course-cta-link" data-click="openLoginModal">
                        <span>ابدأ المادة</span>
                        ${this.icon('arrow-left', 14)}
                      </button>
                    </div>
                  </article>
                `).join('')}
              </div>
            </section>
          </div>

          <footer class="site-footer">
            <div class="site-footer-inner">
              <div class="footer-col footer-brand-col">
                <div class="footer-brand-row">
                  <img src="/assets/logo.png" alt="شعار منصة متن" class="footer-logo" />
                  <div>
                    <strong class="footer-brand-title">${this.esc(this.publicSettings.platform_name || 'منصة مَتْن (MATN)')}</strong>
                    <span class="footer-brand-sub">${this.esc(teacherDisplay)}</span>
                  </div>
                </div>
                <p class="footer-mission">
                  منصة تعليمية متخصصة في شرح المواد الشرعية للأزهر الشريف بمنهجية واضحة، مذكرات محررة، واختبارات تفاعلية منتظمة.
                </p>
              </div>

              <div class="footer-col">
                <h4 class="footer-col-title">روابط سريعة</h4>
                <ul class="footer-links-list">
                  <li><button type="button" class="footer-link-btn" data-click="scrollToCourses">${this.icon('book-open', 14)} <span>الكورسات والمواد الشرعية</span></button></li>
                  <li><button type="button" class="footer-link-btn" data-click="openLoginModal">${this.icon('log-in', 14)} <span>تسجيل الدخول</span></button></li>
                  <li><button type="button" class="footer-link-btn" data-click="openRegisterModal">${this.icon('user-check', 14)} <span>إنشاء حساب طالب جديد</span></button></li>
                  <li><button type="button" class="footer-link-btn" data-click="openPlatformGuideVideoModal">${this.icon('play', 14)} <span>دليل التسجيل والمذاكرة بالفيديو</span></button></li>
                </ul>
              </div>

              <div class="footer-col">
                <h4 class="footer-col-title">الدعم والتواصل</h4>
                <ul class="footer-links-list">
                  ${supportWaUrl ? `<li><a href="${this.esc(supportWaUrl)}" target="_blank" rel="noopener noreferrer" class="footer-link-btn">${this.icon('message-circle', 14)} <span>التواصل مع الدعم الفني</span></a></li>` : ''}
                  <li><button type="button" class="footer-link-btn" data-click="openPrivacyPolicyModal">${this.icon('lock', 14)} <span>سياسة الخصوصية وشروط الاستخدام</span></button></li>
                  <li class="footer-info-note">${this.icon('calendar', 14)} <span>تقارير متابعة تلقائية لولي الأمر كل جمعة</span></li>
                </ul>
              </div>
            </div>

            <div class="site-footer-bottom">
              <span>جميع الحقوق محفوظة © ${new Date().getFullYear()} ${this.esc(this.publicSettings.platform_name || 'منصة مَتْن (MATN)')}</span>
              <span>للمرحلتين الإعدادية والثانوية الأزهرية</span>
            </div>
          </footer>
        </div>
      `;
    },

    /* ========================================================================
       STANDALONE FULL-PAGE AUTH VIEWS (#/login, #/register, #/forgot-password)
       ======================================================================== */

    openLoginModal() {
      this.openLoginPage();
    },

    openLoginPage() {
      this.closeModal();
      this.renderLoginPage(true);
    },

    renderLoginPage(updateHash = true) {
      this.currentView = 'login';
      if (updateHash) this.setHashRoute('/login');
      this.renderNavbar();
      const root = document.getElementById('appRoot');
      const teacherDisplay = String(this.publicSettings.teacher_name || 'فضيلة الأستاذ محمد عبد الله').replace(/عبد\s+الله/g, 'عبد\u00A0الله');

      root.innerHTML = `
        <div class="auth-page-wrap fade-in">
          <div class="auth-split-card">
            <section class="auth-form-pane">
              <div class="auth-top-bar">
                <button type="button" class="auth-back-link" data-click="navigateHome">
                  ${this.icon('arrow-right', 15)}
                  <span>العودة للرئيسية</span>
                </button>
                <button type="button" class="auth-switch-link" data-click="openRegisterModal">
                  <span>حساب جديد</span>
                  ${this.icon('arrow-left', 14)}
                </button>
              </div>

              <div class="auth-heading-block">
                <h2 class="auth-page-title">تسجيل الدخول</h2>
                <p class="auth-page-subtitle">أدخل رقم الهاتف وكلمة المرور للوصول إلى محاضراتك واختباراتك.</p>
              </div>

              ${this.renderDemoQuickAccessPanel(true)}

              <form data-submit="handleLogin" class="auth-form">
                <div class="form-group">
                  <label for="loginPhone">رقم الهاتف</label>
                  <input type="tel" id="loginPhone" class="form-control" placeholder="010xxxxxxxx" autocomplete="username" required />
                </div>
                <div class="form-group">
                  <label for="loginPassword">كلمة المرور</label>
                  <input type="password" id="loginPassword" class="form-control" placeholder="••••••••" autocomplete="current-password" required />
                </div>
                <div class="auth-inline-row">
                  <button type="button" class="auth-text-action" data-click="openForgotPasswordModal">
                    ${this.icon('key', 14)}
                    <span>نسيت كلمة المرور؟</span>
                  </button>
                </div>
                <div id="loginErrorBox" style="display:none; margin-bottom:14px;"></div>
                <button type="submit" id="loginSubmitBtn" class="btn btn-gold btn-block auth-submit-btn">
                  ${this.icon('log-in', 17)}
                  <span>دخول إلى المنصة</span>
                </button>
              </form>

              <div class="auth-bottom-switch">
                <span>طالب جديد في منصة مَتْن؟</span>
                <button type="button" class="auth-text-action" data-click="openRegisterModal">أنشئ حسابك الآن</button>
              </div>
            </section>

            <aside class="auth-brand-pane">
              <div class="auth-brand-inner">
                <img src="/assets/logo.png" alt="شعار منصة متن" class="auth-brand-logo" />
                <span class="auth-brand-kicker">منصة العلوم الشرعية للأزهر الشريف</span>
                <h3 class="auth-brand-heading">${this.esc(this.publicSettings.platform_name || 'منصة مَتْن (MATN)')}</h3>
                <p class="auth-brand-teacher">${this.esc(teacherDisplay)}</p>
                <ul class="auth-brand-points">
                  <li>${this.icon('check-circle', 16)} <span>محاضرات مرئية محمية ومذكرات PDF منظمة</span></li>
                  <li>${this.icon('check-circle', 16)} <span>اختبارات على النظام الأزهري وبنك أخطاء تفاعلي</span></li>
                  <li>${this.icon('check-circle', 16)} <span>تقارير متابعة أسبوعية لولي الأمر</span></li>
                </ul>
                <button type="button" class="btn btn-outline-gold btn-sm auth-guide-btn" data-click="openPlatformGuideVideoModal">
                  ${this.icon('play', 14)}
                  <span>مشاهدة دليل الاستخدام بالفيديو</span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      `;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    openRegisterModal() {
      this.openRegisterPage();
    },

    openRegisterPage() {
      this.closeModal();
      this.renderRegisterPage(true);
    },

    renderRegisterPage(updateHash = true) {
      this.currentView = 'register';
      if (updateHash) this.setHashRoute('/register');
      this.renderNavbar();
      const root = document.getElementById('appRoot');
      const isVoucherMode = this.registrationMode === 'voucher_code';
      const isOtpMode = this.registrationMode === 'whatsapp_otp';
      const teacherDisplay = String(this.publicSettings.teacher_name || 'فضيلة الأستاذ محمد عبد الله').replace(/عبد\s+الله/g, 'عبد\u00A0الله');

      root.innerHTML = `
        <div class="auth-page-wrap fade-in">
          <div class="auth-split-card is-wide">
            <section class="auth-form-pane">
              <div class="auth-top-bar">
                <button type="button" class="auth-back-link" data-click="navigateHome">
                  ${this.icon('arrow-right', 15)}
                  <span>العودة للرئيسية</span>
                </button>
                <button type="button" class="auth-switch-link" data-click="openLoginModal">
                  <span>لديك حساب؟ دخول</span>
                  ${this.icon('arrow-left', 14)}
                </button>
              </div>

              <div class="auth-heading-block">
                <h2 class="auth-page-title">إنشاء حساب طالب جديد</h2>
                <p class="auth-page-subtitle">
                  ${isOtpMode
                    ? 'أدخل بياناتك الدراسية وسيتم إرسال رمز التفعيل إلى رقم الواتساب الخاص بك.'
                    : 'أدخل بياناتك الدراسية وكود التفعيل لفتح المنصة والمحاضرات فوراً.'}
                </p>
              </div>

              <form data-submit="handleRegister" class="auth-form">
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

                <div class="form-row-2">
                  <div class="form-group">
                    <label for="regPassword">كلمة المرور (٨ أحرف على الأقل)</label>
                    <input type="password" id="regPassword" class="form-control" placeholder="••••••••" minlength="8" required />
                  </div>
                  ${!isOtpMode ? `
                    <div class="form-group">
                      <label for="regActivationCode">كود التفعيل ${isVoucherMode ? '*' : '(اختياري)'}</label>
                      <input type="text" id="regActivationCode" class="form-control" placeholder="MATN-DEMO-30D-001" style="text-align:center; font-weight:700; letter-spacing:1px;" ${isVoucherMode ? 'required' : ''} />
                    </div>
                  ` : ''}
                </div>

                <div class="auth-privacy-note">
                  بتسجيلك فإنك توافق على
                  <button type="button" class="auth-text-action" data-click="openPrivacyPolicyModal">سياسة الخصوصية وشروط الاستخدام</button>.
                </div>

                <div id="regErrorBox" style="display:none; margin-bottom:12px;"></div>

                <button type="submit" class="btn btn-gold btn-block auth-submit-btn">
                  ${this.icon(isOtpMode ? 'smartphone' : 'check-circle', 17)}
                  <span>${isOtpMode ? 'تسجيل وإرسال كود الواتساب' : 'تسجيل وتفعيل الحساب الآن'}</span>
                </button>
              </form>

              ${!isOtpMode ? `
                <div class="auth-request-code-wrap">
                  <button type="button" class="btn btn-outline-gold btn-sm btn-block" data-click="toggleRequestCodePanel">
                    ${this.icon('ticket', 15)} <span>ليس لديك كود تفعيل؟ حوّل واطلبه من الدعم الآن</span>
                  </button>
                  <div id="regRequestCodeBox" style="display:none; margin-top:10px; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:12px; padding:12px;">
                    ${this.renderPaymentChannelsBox()}
                    <div class="form-group" style="margin-bottom:8px;">
                      <label for="regTransferNumber" style="font-size:0.78rem;">الرقم أو الحساب الذي حوّلت منه المبلغ</label>
                      <input type="text" id="regTransferNumber" class="form-control" placeholder="اكتب رقم الهاتف أو حساب إنستا باي المحوَّل منه..." />
                    </div>
                    <button type="button" class="btn btn-whatsapp btn-sm btn-block" data-click="requestActivationCodeViaWhatsapp">
                      ${this.icon('message-circle', 15)} <span>تواصل مع الدعم لطلب كود التفعيل</span>
                    </button>
                  </div>
                </div>
              ` : ''}

              <div class="auth-bottom-switch">
                <span>لديك حساب بالفعل؟</span>
                <button type="button" class="auth-text-action" data-click="openLoginModal">سجّل دخولك الآن</button>
              </div>
            </section>

            <aside class="auth-brand-pane">
              <div class="auth-brand-inner">
                <img src="/assets/logo.png" alt="شعار منصة متن" class="auth-brand-logo" />
                <span class="auth-brand-kicker">انضم لطلاب منصة مَتْن</span>
                <h3 class="auth-brand-heading">ابدأ رحلتك في التفوق الشرعي</h3>
                <p class="auth-brand-teacher">${this.esc(teacherDisplay)}</p>
                <ul class="auth-brand-points">
                  <li>${this.icon('shield-check', 16)} <span>حساب شخصي مربوط بجهازك لحفظ تقدمك</span></li>
                  <li>${this.icon('book-open', 16)} <span>تنظيم تلقائي للمواد حسب صفك وشعبتك</span></li>
                  <li>${this.icon('trophy', 16)} <span>لوحة شرف وشارات إنجاز وشهادات تفوق</span></li>
                </ul>
                ${this.demoAccounts ? `
                  <button type="button" class="btn btn-outline-gold btn-sm auth-guide-btn" data-click="demoLogin" data-arg="student">
                    ${this.icon('zap', 14)}
                    <span>أو جرّب المنصة فوراً كطالب تجريبي</span>
                  </button>
                ` : ''}
              </div>
            </aside>
          </div>
        </div>
      `;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    openForgotPasswordModal() {
      this.openForgotPasswordPage();
    },

    openForgotPasswordPage() {
      this.closeModal();
      this.renderForgotPasswordPage(true);
    },

    renderForgotPasswordPage(updateHash = true) {
      this.currentView = 'forgot_password';
      if (updateHash) this.setHashRoute('/forgot-password');
      this.renderNavbar();
      const root = document.getElementById('appRoot');

      root.innerHTML = `
        <div class="auth-page-wrap fade-in">
          <div class="auth-single-card">
            <div class="auth-top-bar">
              <button type="button" class="auth-back-link" data-click="openLoginModal">
                ${this.icon('arrow-right', 15)}
                <span>العودة لتسجيل الدخول</span>
              </button>
            </div>
            <div class="auth-heading-block" style="text-align:center;">
              <div style="color:var(--gold-400); margin-bottom:10px;">${this.icon('key', 34)}</div>
              <h2 class="auth-page-title">استعادة كلمة المرور</h2>
              <p class="auth-page-subtitle">أدخل رقم هاتفك المسجل لإرسال رمز إعادة التعيين عبر الواتساب.</p>
            </div>

            <form data-submit="handleForgotPassword" class="auth-form">
              <div class="form-group">
                <label for="forgotPhone">رقم الهاتف المسجل</label>
                <input type="tel" id="forgotPhone" class="form-control" placeholder="010xxxxxxxx" required />
              </div>
              <button type="submit" class="btn btn-gold btn-block auth-submit-btn">
                ${this.icon('smartphone', 16)}
                <span>إرسال كود الاستعادة</span>
              </button>
            </form>
          </div>
        </div>
      `;
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
          <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">${this.icon('x', 15)} <span>إغلاق</span></button>
        </div>
        <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:12px;">
          شاهد خطوات إنشاء الحساب، تفعيل الكود الشهري، ومشاهدة المحاضرات وحل الاختبارات التفاعلية في دقيقتين.
        </p>
        <div style="border:1px solid var(--border-gold); border-radius:14px; overflow:hidden; background:#000;">
          <video id="modalGuideVideo" src="/assets/matn_guide_video.mp4" controls autoplay playsinline style="width:100%; display:block; max-height:68vh;"></video>
        </div>
      `, '820px');
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
        this.setAuthSession(res.token, res.csrf_token);
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
          <button type="submit" class="btn btn-gold btn-block">${this.icon('check-circle', 16)} <span>حفظ كلمة المرور الجديدة</span></button>
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
        this.closeModal();
        this.showToast(res.message, 'success');
        this.openLoginPage();
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
        this.setAuthSession(res.token, res.csrf_token);
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
                <div style="font-weight:700; color:var(--danger-text); margin-bottom:6px; font-size:0.86rem;">${this.esc(err.data.error)}</div>
                <div style="font-size:0.78rem; color:var(--text-primary); margin-bottom:10px;">الجهاز المسجل: <b>${this.esc(err.data.registered_device)}</b></div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button type="button" class="btn btn-outline-gold btn-sm" style="flex:1;" data-click="requestDeviceReset">
                    ${this.icon('refresh', 14)} <span>طلب إعادة تعيين الجهاز</span>
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
          <div style="font-weight:700; color:var(--gold-400); margin-bottom:8px; display:flex; align-items:center; gap:6px;">${this.icon('ticket', 16)} <span>أرقام التحويل الرسمية للاشتراك:</span></div>
          ${vf ? `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
              <span>• <b>فودافون كاش:</b> <span dir="ltr" style="color:var(--text-primary); font-weight:700;">${this.esc(vf)}</span></span>
              <button type="button" class="btn btn-outline-gold btn-sm" style="padding:4px 10px; font-size:0.74rem;" data-click="copyText" data-copy="${this.esc(vf)}" data-label="رقم فودافون كاش">${this.icon('copy', 13)} <span>نسخ</span></button>
            </div>
          ` : ''}
          ${ip ? `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
              <span>• <b>إنستا باي (InstaPay):</b> <span dir="ltr" style="color:var(--text-primary); font-weight:700;">${this.esc(ip)}</span></span>
              <button type="button" class="btn btn-outline-gold btn-sm" style="padding:4px 10px; font-size:0.74rem;" data-click="copyText" data-copy="${this.esc(ip)}" data-label="حساب إنستا باي">${this.icon('copy', 13)} <span>نسخ</span></button>
            </div>
          ` : ''}
        </div>
      `;
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
      const a = document.createElement('a');
      a.href = waUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
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
          this.setAuthSession(res.token, res.csrf_token);
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
            <button type="submit" class="btn btn-gold btn-block">${this.icon('check-circle', 16)} <span>تأكيد الكود وتفعيل الحساب</span></button>
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
        this.setAuthSession(res.token, res.csrf_token);
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
            <input type="text" name="voucher_code" id="modalVoucherCodeInput" class="form-control" placeholder="MATN-DEMO-30D-001" style="text-align:center; font-size:1.15rem; font-weight:700; letter-spacing:1.5px;" required />
          </div>
          <button type="submit" class="btn btn-gold btn-block">${this.icon('zap', 16)} <span>تفعيل اشتراك ٣٠ يوماً الآن</span></button>
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
