import {
  SUBJECTS_META,
  PREP_GRADES,
  PREP_SUBJECT_KEYS,
  SEC_BASE_SUBJECT_KEYS,
  GRADE_3_SUBJECT_KEYS,
  GRADES_META
} from './constants.js';
import { renderIcon } from './icons.js';
import {
  normalizeDigits,
  normalizePhoneInput,
  safeHttpsUrl,
  esc,
  getCookie,
  getOrCreateDeviceId,
  detectDeviceName
} from './utils.js';
import { registerAuthMethods } from './auth-views.js';
import { registerStudentMethods } from './student-views.js';
import { registerAdminMethods } from './admin-views.js';

class MatnPlatformApp {
  constructor() {
    this.csrfToken = this.getCookie('matn_csrf_token') || '';
    try {
      this.authToken = sessionStorage.getItem('matn_auth_token') || '';
    } catch {
      this.authToken = '';
    }
    this.user = null;
    this.deviceId = this.getOrCreateDeviceId();
    this.deviceName = this.detectDeviceName();
    try {
      this.theme = localStorage.getItem('matn_theme') === 'light' ? 'light' : 'dark';
    } catch {
      this.theme = 'dark';
    }
    document.documentElement.dataset.theme = this.theme;
    this.publicSettings = {
      teacher_name: 'فضيلة الشيخ محمد عبد\u00A0الله',
      platform_name: 'منصة مَتْن (MATN) للمواد الشرعية',
      support_whatsapp: '',
      vodafone_cash_number: '',
      instapay_handle: '',
      azhar_exam_date: '',
      announcement_banner: ''
    };
    this.publicStats = { studentsCount: 0, lessonsCount: 0, examsCount: 0 };
    this.registrationMode = 'voucher_code';
    this.landingCourseStage = 'all';
    this.mobileDrawerOpen = false;
    try {
      this.sidebarCollapsed = localStorage.getItem('matn_sidebar_collapsed') === '1';
    } catch {
      this.sidebarCollapsed = false;
    }
    this.currentView = 'landing';
    this.studentTab = 'curriculum';
    this.selectedSubject = 'fiqh';
    this.lessonQuery = '';
    this.lessonUnitFilter = 'all';
    this.lessonStatusFilter = 'all';
    this.activeLessonId = null;
    this.activeLessonSubTab = 'video';
    this.activeLessonNotes = [];
    this.studentDashboardData = null;
    this.studentMistakesData = null;
    this.mistakeSubjectFilter = 'all';
    this.mistakePracticeMode = false;
    this.mistakePracticeAnswers = {};
    this.studentNotifications = [];
    this.notificationUnreadCount = 0;
    this.studentLiveSessions = [];
    this.adminData = null;
    this.adminTab = 'lessons_list';
    this.adminGradeFilter = 'all';
    this.adminStudentsOffset = 0;
    this.adminVouchersOffset = 0;
    this.adminPageSize = 50;
    this.adminStudentsQuery = '';
    this.adminStudentsFilter = 'all';
    this.adminVouchersQuery = '';
    this.adminVouchersFilter = 'all';
    this.adminExamSubTab = 'list';
    this.adminExamTypeFilter = 'all';
    this.adminExamGradeFilter = 'all';
    this.adminExamQuery = '';
    this.editingAssessment = null;
    this._lastSavedProgressSec = 0;
    this.activeAssessmentSession = null;
    this._lastAssessmentResult = null;
    this._isSubmittingAssessment = false;
    this.examTimerInterval = null;
    this.watermarkInterval = null;
    this.synthCanvasInterval = null;
    this._suppressHashSync = false;

    this.initEventDelegation();
    this.initUiDeterrents();
    this.initSidebarViewportSync();
    window.addEventListener('hashchange', () => this.applyHashRoute());
    this.bootstrap();
  }

  icon(name, size = 18, extraClass = '') {
    return renderIcon(name, size, extraClass);
  }

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.theme;
    try { localStorage.setItem('matn_theme', this.theme); } catch {}
    this.renderNavbar();
  }

  setHashRoute(hashPath) {
    const clean = hashPath.startsWith('#') ? hashPath : `#${hashPath}`;
    if (window.location.hash === clean) return;
    this._suppressHashSync = true;
    window.location.hash = clean;
    setTimeout(() => { this._suppressHashSync = false; }, 0);
  }

  setAuthSession(token, csrfToken) {
    if (token) {
      this.authToken = String(token);
      try { sessionStorage.setItem('matn_auth_token', this.authToken); } catch {}
    }
    if (csrfToken) {
      this.csrfToken = String(csrfToken);
    }
  }

  clearAuthSession() {
    this.authToken = '';
    this.csrfToken = '';
    try { sessionStorage.removeItem('matn_auth_token'); } catch {}
  }

  toggleMobileSidebar() {
    this.mobileDrawerOpen = !this.mobileDrawerOpen;
    this.syncMobileDrawerState();
  }

  closeMobileSidebar() {
    if (!this.mobileDrawerOpen) return;
    this.mobileDrawerOpen = false;
    this.syncMobileDrawerState();
  }

  syncMobileDrawerState() {
    const sidebar = document.querySelector('.app-sidebar');
    const backdrop = document.getElementById('sidebarDrawerBackdrop');
    if (sidebar) sidebar.classList.toggle('drawer-open', this.mobileDrawerOpen);
    if (backdrop) backdrop.classList.toggle('open', this.mobileDrawerOpen);
    document.body.classList.toggle('drawer-open', this.mobileDrawerOpen);
  }

  initSidebarViewportSync() {
    let lastVal = -1;
    let rafId = 0;
    const sync = () => {
      rafId = 0;
      const ribbon = document.querySelector('.top-ribbon');
      let visible = 0;
      if (ribbon && ribbon.offsetHeight > 0) {
        const rect = ribbon.getBoundingClientRect();
        visible = Math.max(0, Math.min(Math.round(rect.height), Math.round(rect.bottom)));
      }
      if (visible !== lastVal) {
        lastVal = visible;
        document.documentElement.style.setProperty('--ribbon-visible', `${visible}px`);
      }
    };
    const schedule = () => {
      if (!rafId) rafId = window.requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
  }

  toggleDesktopSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem('matn_sidebar_collapsed', this.sidebarCollapsed ? '1' : '0'); } catch {}
    const shell = document.querySelector('.app-shell');
    if (shell) shell.classList.toggle('sidebar-collapsed', this.sidebarCollapsed);
    const btn = document.querySelector('.sidebar-collapse-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', String(!this.sidebarCollapsed));
      btn.setAttribute('title', this.sidebarCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية');
    }
  }

  filterLandingCourses(stage = 'all') {
    this.landingCourseStage = ['all', 'sec', 'prep'].includes(stage) ? stage : 'all';
    if (!this.user && this.currentView === 'landing') {
      this.renderLanding();
      const catalog = document.getElementById('coursesCatalog');
      if (catalog) catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  scrollToCourses() {
    if (!this.user && this.currentView !== 'landing') {
      this.setHashRoute('/');
      this.renderLanding();
    }
    const catalog = document.getElementById('coursesCatalog');
    if (catalog) catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  applyHashRoute() {
    if (this._suppressHashSync) return;
    const raw = (window.location.hash || '').replace(/^#/, '');

    if (!this.user) {
      if (raw === '/login') { this.renderLoginPage(false); return; }
      if (raw === '/register') { this.renderRegisterPage(false); return; }
      if (raw === '/forgot-password') { this.renderForgotPasswordPage(false); return; }
      if (raw === '/' || raw === '') { this.renderLanding(); return; }
      return;
    }

    if (!raw) return;

    if (this.user.role === 'admin') {
      const mLesson = raw.match(/^\/lesson\/(\d+)$/);
      if (mLesson) {
        this.openLessonWorkspace(Number(mLesson[1]), 'video', false);
        return;
      }
      const mAdmin = raw.match(/^\/admin(?:\/([a-z_]+))?$/);
      if (mAdmin) {
        this.activeLessonId = null;
        this.stopActiveMediaLoops();
        this.adminTab = mAdmin[1] || 'lessons_list';
        this.renderAdminDashboard();
      }
      return;
    }

    const mLesson = raw.match(/^\/lesson\/(\d+)$/);
    if (mLesson) {
      this.openLessonWorkspace(Number(mLesson[1]), 'video', false);
      return;
    }
    if (raw === '/mistakes') return this.switchStudentTab('mistakes', false);
    if (raw === '/live') return this.switchStudentTab('live', false);
    if (raw === '/analytics') return this.switchStudentTab('analytics', false);
    if (raw === '/subscription') return this.switchStudentTab('subscription', false);
    if (raw === '/dashboard' || raw === '/') {
      this.stopActiveMediaLoops();
      this.activeLessonId = null;
      this.studentTab = 'curriculum';
      this.renderStudentPortal();
    }
  }

  renderSkeletonView(titleText = 'جاري تحميل البيانات...') {
    return `
      <div class="container fade-in">
        <div class="section-card">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:18px; color:var(--gold-400); font-weight:800;">
            ${this.icon('refresh', 18)}
            <span>${this.esc(titleText)}</span>
          </div>
          <div class="grid-2">
            ${[1, 2, 3, 4].map(() => `
              <div class="skeleton-card">
                <div class="skeleton-line sm"></div>
                <div class="skeleton-line lg"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line" style="width:78%;"></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  initEventDelegation() {
    document.addEventListener('play', (e) => {
      if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
        this.stopAllVideos(e.target);
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('globalModal');
        if (modal && modal.classList.contains('open')) this.closeModal();
        if (this.mobileDrawerOpen) this.closeMobileSidebar();
        return;
      }

      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      const vid = document.getElementById('protectedHtmlVideo');
      if (!vid) return;
      const k = (e.key || '').toLowerCase();
      if (e.code === 'Space' || k === 'k') {
        e.preventDefault();
        this.toggleProtectedPlay();
      } else if (e.key === 'ArrowRight' || k === 'l') {
        e.preventDefault();
        this.seekVideoRelative(10);
      } else if (e.key === 'ArrowLeft' || k === 'j') {
        e.preventDefault();
        this.seekVideoRelative(-10);
      } else if (k === 'f') {
        e.preventDefault();
        this.toggleProtectedFullscreen();
      }
    });

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'globalModal') {
        this.closeModal();
        return;
      }
      const target = e.target.closest('[data-click]');
      if (!target) return;
      const action = target.dataset.click;
      const arg = target.dataset.arg;
      const id = target.dataset.id ? Number(target.dataset.id) : null;

      switch (action) {
        case 'navigateHome': return this.navigateHome();
        case 'toggleTheme': return this.toggleTheme();
        case 'toggleMobileSidebar': return this.toggleMobileSidebar();
        case 'closeMobileSidebar': return this.closeMobileSidebar();
        case 'toggleDesktopSidebar': return this.toggleDesktopSidebar();
        case 'filterLandingCourses': return this.filterLandingCourses(arg || 'all');
        case 'scrollToCourses': return this.scrollToCourses();
        case 'logout': return this.logout();
        case 'closeModal': return this.closeModal();
        case 'openLoginModal': return this.openLoginPage();
        case 'openRegisterModal': return this.openRegisterPage();
        case 'toggleRequestCodePanel': return this.toggleRequestCodePanel();
        case 'requestActivationCodeViaWhatsapp': return this.requestActivationCodeViaWhatsapp();
        case 'openForgotPasswordModal': return this.openForgotPasswordPage();
        case 'openPrivacyPolicyModal': return this.openPrivacyPolicyModal();
        case 'openPlatformGuideVideoModal': return this.openPlatformGuideVideoModal();
        case 'openRedeemVoucherModal': return this.openRedeemVoucherModal();
        case 'requestDeviceReset': return this.requestDeviceReset();
        case 'resendOtp': return this.resendOtp(arg || '');
        case 'switchStudentTab': { this.closeMobileSidebar(); return this.switchStudentTab(arg); }
        case 'selectSubject': { this.closeMobileSidebar(); return this.selectSubject(arg); }
        case 'resetLessonFilters': return this.resetLessonFilters();
        case 'openNotificationsModal': { this.closeMobileSidebar(); return this.openNotificationsModal(); }
        case 'markAllNotificationsRead': return this.markAllNotificationsRead();
        case 'joinLiveSession': return this.joinLiveSession(id);
        case 'openLessonWorkspace': return this.openLessonWorkspace(id, arg || 'video');
        case 'switchLessonSubTab': return this.switchLessonSubTab(arg);
        case 'jumpToVideoSecond': return this.jumpToVideoSecond(Number(arg || 0));
        case 'deleteLessonNote': return this.deleteLessonNote(id);
        case 'seekVideoRelative': return this.seekVideoRelative(Number(arg || 0));
        case 'filterMistakesSubject': return this.filterMistakesSubject(arg || 'all');
        case 'startMistakePractice': return this.startMistakePractice();
        case 'selectPracticeOption': return this.selectPracticeOption(id, Number(target.dataset.oindex));
        case 'resetMistakePractice': return this.resetMistakePractice();
        case 'scrollToQuestion': return this.scrollToQuestion(id);
        case 'toggleQuestionFlag': return this.toggleQuestionFlag(id);
        case 'downloadCertificate': return this.downloadCertificate(id);
        case 'shareCertificate': return this.shareCertificate(id);
        case 'resumeFromCurtain': {
          const c = document.getElementById('videoSecurityCurtain');
          if (c) {
            delete c.dataset.lockedByViolation;
            c.classList.remove('active');
          }
          return;
        }
        case 'toggleProtectedPlay': return this.toggleProtectedPlay();
        case 'toggleProtectedFullscreen': return this.toggleProtectedFullscreen();
        case 'startAssessment': return this.startAssessment(id);
        case 'selectMcqOption': return this.selectMcqOptionByIndex(id, Number(target.dataset.oindex));
        case 'submitAssessment': return this.submitAssessment();
        case 'viewSubmissionReview': return this.viewSubmissionReview(id);
        case 'switchAdminTab': { this.closeMobileSidebar(); return this.switchAdminTab(arg); }
        case 'openAdminTabGuide': return this.openAdminTabGuide(arg || this.adminTab);
        case 'switchAdminExamSubTab': return this.switchAdminExamSubTab(arg || 'list');
        case 'openAssessmentEditorDirect': return this.openAssessmentEditorDirect(id, Number(target.dataset.lessonId));
        case 'loadAdminDashboard': return this.loadAdminDashboard(true);
        case 'openEditLessonModal': return this.openEditLessonModal(id);
        case 'toggleLessonPublish': return this.toggleLessonPublish(id, Number(target.dataset.next));
        case 'openLessonAssessmentsModal': return this.openLessonAssessmentsModal(id);
        case 'deleteLesson': return this.deleteLesson(id);
        case 'toggleAssessmentActive': return this.toggleAssessmentActive(id, Number(target.dataset.next), Number(target.dataset.lessonId), target.dataset.source || '');
        case 'openEditAssessmentModal': return this.openEditAssessmentModal(id, Number(target.dataset.lessonId));
        case 'deleteAssessment': return this.deleteAssessment(id, Number(target.dataset.lessonId), target.dataset.source || '');
        case 'addMoreQuestionRow': return this.addMoreQuestionRow(target.dataset.container || 'adminMcqQuestionsList', target.dataset.qtype || 'mcq');
        case 'duplicateQuestionRow': return this.duplicateQuestionRow(target);
        case 'removeAdminQuestionRow': return this.removeAdminQuestionRow(target);
        case 'moveQuestionRow': return this.moveQuestionRow(target, target.dataset.dir || 'up');
        case 'setTfQuestionAnswer': return this.setTfQuestionAnswer(target, target.dataset.val || 'صح');
        case 'closeInlineAssessmentEditor': return this.closeInlineAssessmentEditor();
        case 'openScheduleRetakeModal': return this.openScheduleRetakeModal(id);
        case 'verifyStudentWhatsappManually': return this.verifyStudentWhatsappManually(id);
        case 'resetStudentDevice': return this.resetStudentDevice(id);
        case 'openResetStudentPasswordModal': return this.openResetStudentPasswordModal(id, target.dataset.name || '');
        case 'grantStudentMonth': return this.grantStudentMonth(id);
        case 'lockStudentAccount': return this.setStudentLockStatus(id, true);
        case 'unlockStudentAccount': return this.setStudentLockStatus(id, false);
        case 'deleteStudentAccount': return this.deleteStudentAccount(id);
        case 'pageStudents':
          this.adminStudentsOffset = Math.max(0, Number(arg || 0));
          return this.loadAdminDashboard(true);
        case 'pageVouchers':
          this.adminVouchersOffset = Math.max(0, Number(arg || 0));
          return this.loadAdminDashboard(true);
        case 'openSendVoucherModal': return this.openSendVoucherModal(id);
        case 'releaseVoucherAssignment': return this.releaseVoucherAssignment(id);
        case 'regenerateQuickGreeting': return this.regenerateQuickGreeting();
        case 'resetQuickVoucherReply': return this.resetQuickVoucherReply();
        case 'copyText': return this.copyToClipboard(target.dataset.copy || target.dataset.arg || '', target.dataset.label || '');
        case 'openBulkImportQuestionsModal': return this.openBulkImportQuestionsModal(target.dataset.container || 'adminMcqQuestionsList');
        case 'openParentReportModal': return this.openParentReportModal(id);
        case 'runWeeklyParentReports': return this.runWeeklyParentReports();
        case 'sendNextSequentialWeeklyReport': return this.sendNextSequentialWeeklyReport(id);
        case 'copyAllWeeklyReports': return this.copyAllWeeklyReports();
        case 'deleteLessonQuestion': return this.deleteLessonQuestion(id);
        case 'updateLiveSessionStatus': return this.updateLiveSessionStatus(id, arg);
        case 'viewLiveAttendance': return this.viewLiveAttendance(id);
        case 'deleteLiveSession': return this.deleteLiveSession(id);
        case 'deleteAdminNotification': return this.deleteAdminNotification(id);
        case 'printVouchers': return window.print();
        default: break;
      }
    });

    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-submit]');
      if (!form) return;
      const action = form.dataset.submit;
      const arg = form.dataset.arg;
      const id = form.dataset.id ? Number(form.dataset.id) : null;

      switch (action) {
        case 'handleLogin': return this.handleLogin(e);
        case 'handleRegister': return this.handleRegister(e);
        case 'handleVerifyOtp': return this.handleVerifyOtp(e, arg || '');
        case 'handleForgotPassword': return this.handleForgotPassword(e);
        case 'handleResetPassword': return this.handleResetPassword(e, arg || '');
        case 'handleRedeemVoucher': return this.handleRedeemVoucher(e);
        case 'handleCreateLesson': return this.handleCreateLesson(e);
        case 'handleEditLessonSubmit': return this.handleEditLessonSubmit(e, id);
        case 'handleCreateAssessment': return this.handleCreateAssessment(e);
        case 'handleEditAssessmentSubmit': return this.handleEditAssessmentSubmit(e, id, Number(form.dataset.lessonId));
        case 'handleScheduleRetakeSubmit': return this.handleScheduleRetakeSubmit(e, id);
        case 'handleAdminResetPasswordSubmit': return this.handleAdminResetPasswordSubmit(e, id);
        case 'handleGenerateVouchers': return this.handleGenerateVouchers(e);
        case 'handleSendVoucherSubmit': return this.handleSendVoucherSubmit(e, id);
        case 'handleQuickVoucherReplySubmit': return this.handleQuickVoucherReplySubmit(e);
        case 'handleSaveSettings': return this.handleSaveSettings(e);
        case 'handleBulkImportQuestionsSubmit': return this.handleBulkImportQuestionsSubmit(e, form.dataset.container || 'adminMcqQuestionsList');
        case 'handleAskLessonQuestion': return this.handleAskLessonQuestion(e, id);
        case 'handleAddLessonNote': return this.handleAddLessonNote(e, id);
        case 'handleAnswerLessonQuestion': return this.handleAnswerLessonQuestion(e, id);
        case 'handleCreateLiveSession': return this.handleCreateLiveSession(e);
        case 'handleSendAdminNotification': return this.handleSendAdminNotification(e);
        default: break;
      }
    });

    document.addEventListener('change', (e) => {
      const target = e.target.closest('[data-change]');
      if (!target) return;
      switch (target.dataset.change) {
        case 'onRegGradeChange': return this.onRegGradeChange();
        case 'onAdminLessonGradeChange': return this.onAdminLessonGradeChange();
        case 'onEditLessonGradeChange': return this.onEditLessonGradeChange();
        case 'onLiveGradeChange': return this.onLiveGradeChange();
        case 'onLessonUnitFilterChange':
          this.lessonUnitFilter = target.value;
          return this.renderStudentPortal();
        case 'onLessonStatusFilterChange':
          this.lessonStatusFilter = target.value;
          return this.renderStudentPortal();
        case 'onAdminFilterGrade':
          this.adminGradeFilter = target.value;
          return this.renderAdminDashboard();
        case 'onAdminStudentsFilterChange':
          this.adminStudentsFilter = target.value;
          this.adminStudentsOffset = 0;
          return this.loadAdminDashboard(true);
        case 'onAdminVouchersFilterChange':
          this.adminVouchersFilter = target.value;
          this.adminVouchersOffset = 0;
          return this.loadAdminDashboard(true);
        case 'onLessonVideoTypeChange': return this.onLessonVideoTypeChange(target.value);
        case 'uploadAdminFile': return this.uploadAdminFile(target, target.dataset.uploadType || 'video');
        case 'uploadToBunnyStream': return this.uploadToBunnyStream(target);
        case 'setHiddenValue': {
          const el = document.getElementById(target.dataset.targetId || '');
          if (el) el.value = target.value;
          return;
        }
        case 'changeVideoSpeed': return this.changeVideoSpeed(target.value);
        case 'onAdminQuestionTypeChange': return this.onAdminQuestionTypeChange(target);
        case 'filterAdminExamsType':
          this.adminExamTypeFilter = target.value || 'all';
          return this.renderAdminDashboard();
        case 'filterAdminExamsGrade':
          this.adminExamGradeFilter = target.value || 'all';
          return this.renderAdminDashboard();
        case 'onSelectRegisteredStudentForVoucher': return this.onSelectRegisteredStudentForVoucher(target);
        case 'onQuickVoucherFieldChange': return this.onQuickVoucherFieldChange();
        default: break;
      }
    });

    document.addEventListener('input', (e) => {
      const target = e.target.closest('[data-input]');
      if (!target) return;
      if (target.dataset.input === 'seekProtectedVideo') {
        this.seekProtectedVideo(target.value);
      } else if (target.dataset.input === 'onLessonSearchInput') {
        this.lessonQuery = target.value;
        clearTimeout(this._lessonSearchTimer);
        this._lessonSearchTimer = setTimeout(() => {
          this.renderStudentPortal();
          const el = document.getElementById('studentLessonSearchInput');
          if (el) {
            el.focus();
            try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
          }
        }, 140);
      } else if (target.dataset.input === 'searchRegisteredStudentsForVoucher') {
        this.searchRegisteredStudentsForVoucher(target.value);
      } else if (target.dataset.input === 'parseQuickVoucherRequest') {
        this.parseQuickVoucherRequest(target.value);
      } else if (target.dataset.input === 'onQuickVoucherFieldChange') {
        this.onQuickVoucherFieldChange();
      } else if (target.dataset.input === 'markQuickGreetingCustom') {
        this._quickGreetingEditedManually = true;
        this._quickVoucherGreeting = target.value;
      } else if (target.dataset.input === 'searchAdminStudents') {
        this.adminStudentsQuery = target.value;
        this.adminStudentsOffset = 0;
        clearTimeout(this._adminStudentsSearchTimer);
        this._adminStudentsSearchTimer = setTimeout(() => {
          this.loadAdminDashboard(true, 'adminStudentsSearchInput');
        }, 280);
      } else if (target.dataset.input === 'searchAdminVouchers') {
        this.adminVouchersQuery = target.value;
        this.adminVouchersOffset = 0;
        clearTimeout(this._adminVouchersSearchTimer);
        this._adminVouchersSearchTimer = setTimeout(() => {
          this.loadAdminDashboard(true, 'adminVouchersSearchInput');
        }, 280);
      } else if (target.dataset.input === 'searchAdminExams') {
        this.adminExamQuery = target.value;
        clearTimeout(this._adminExamsSearchTimer);
        this._adminExamsSearchTimer = setTimeout(() => {
          this.renderAdminDashboard();
          const el = document.getElementById('adminExamsSearchInput');
          if (el) {
            el.focus();
            try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
          }
        }, 140);
      } else if (target.dataset.input === 'updateExamBuilderSummary') {
        const containerId = target.dataset.container || target.closest('tbody')?.id || 'adminMcqQuestionsList';
        this.updateExamBuilderSummary(containerId);
      } else if (target.dataset.input === 'filterInlineQuestions') {
        this.filterInlineQuestionsTable(target.dataset.container || 'adminMcqQuestionsList', target.value);
      }
    });
  }

  normalizeDigits(str) { return normalizeDigits(str); }
  normalizePhoneInput(raw) { return normalizePhoneInput(raw); }
  safeHttpsUrl(rawUrl, fallback = '') { return safeHttpsUrl(rawUrl, fallback); }
  esc(value) { return esc(value); }
  getCookie(name) { return getCookie(name); }
  getOrCreateDeviceId() { return getOrCreateDeviceId(); }
  detectDeviceName() { return detectDeviceName(); }

  formatSupportWaUrl(messageText = '') {
    const raw = String(this.publicSettings?.support_whatsapp || '').replace(/[^\d]/g, '');
    if (!raw) return '';
    const intl = raw.startsWith('0') ? `2${raw}` : raw;
    return `https://wa.me/${intl}${messageText ? `?text=${encodeURIComponent(messageText)}` : ''}`;
  }

  syncPublicBrandingElements() {
    const s = this.publicSettings || {};
    const bannerEl = document.getElementById('topBannerText');
    if (bannerEl && s.announcement_banner) bannerEl.textContent = s.announcement_banner;
    const navTitle = document.getElementById('navPlatformTitle');
    if (navTitle && s.platform_name) {
      const shortBrand = s.platform_name.split('(')[0].trim() || 'منصة مَتْن';
      navTitle.innerHTML = `<span class="nav-title-full">${this.esc(s.platform_name)}</span><span class="nav-title-short">${this.esc(shortBrand)}</span>`;
    }
    const navTeacher = document.getElementById('navTeacherName');
    if (navTeacher && s.teacher_name) navTeacher.textContent = s.teacher_name;

    const topWrap = document.getElementById('topSupportWaWrap');
    const topWa = document.getElementById('topSupportWaLink');
    const waUrl = this.formatSupportWaUrl();
    if (topWa && topWrap) {
      if (waUrl) {
        topWa.href = waUrl;
        topWa.innerHTML = `${this.icon('message-circle', 14)} <span>تواصل مع الدعم</span>`;
        topWrap.style.display = 'inline';
      } else {
        topWa.href = '#';
        topWrap.style.display = 'none';
      }
    }
  }

  isPrepGrade(grade) { return PREP_GRADES.includes(grade); }
  getSubjectsForGrade(grade) {
    if (this.isPrepGrade(grade)) return PREP_SUBJECT_KEYS;
    if (grade === 'grade_3') return GRADE_3_SUBJECT_KEYS;
    return SEC_BASE_SUBJECT_KEYS;
  }
  getSubjectName(subjectKey, grade) {
    const meta = SUBJECTS_META[subjectKey];
    if (!meta) return subjectKey;
    return this.isPrepGrade(grade) ? (meta.prepName || meta.name) : meta.name;
  }
  renderSubjectOptionsForGrade(grade, selected = 'fiqh') {
    const keys = this.getSubjectsForGrade(grade);
    const active = keys.includes(selected) ? selected : keys[0];
    return keys.map((k) => `<option value="${k}" ${active === k ? 'selected' : ''}>${this.esc(this.getSubjectName(k, grade))}</option>`).join('');
  }
  renderGradeOptions(selected = 'grade_3', allLabel = '') {
    const opt = (val) => `<option value="${val}" ${selected === val ? 'selected' : ''}>${this.esc(GRADES_META[val])}</option>`;
    return `
      ${allLabel ? `<option value="all" ${selected === 'all' ? 'selected' : ''}>${this.esc(allLabel)}</option>` : ''}
      <optgroup label="المرحلة الإعدادية الأزهرية">${opt('prep_1')}${opt('prep_2')}${opt('prep_3')}</optgroup>
      <optgroup label="المرحلة الثانوية الأزهرية">${opt('grade_1')}${opt('grade_2')}${opt('grade_3')}</optgroup>
    `;
  }

  onRegGradeChange() {
    const gradeEl = document.getElementById('regGrade');
    const branchEl = document.getElementById('regBranch');
    if (!gradeEl || !branchEl) return;
    if (this.isPrepGrade(gradeEl.value)) {
      branchEl.innerHTML = '<option value="general" selected>عام (المرحلة الإعدادية)</option>';
    } else {
      const prev = branchEl.value === 'literary' ? 'literary' : 'scientific';
      branchEl.innerHTML = `<option value="scientific" ${prev === 'scientific' ? 'selected' : ''}>القسم العلمي</option><option value="literary" ${prev === 'literary' ? 'selected' : ''}>القسم الأدبي</option>`;
    }
  }

  onAdminLessonGradeChange() {
    const gradeEl = document.getElementById('newLessonGrade');
    const branchEl = document.getElementById('newLessonBranch');
    const subjEl = document.getElementById('newLessonSubject');
    if (!gradeEl || !branchEl) return;
    if (subjEl) subjEl.innerHTML = this.renderSubjectOptionsForGrade(gradeEl.value, subjEl.value);
    branchEl.innerHTML = this.isPrepGrade(gradeEl.value)
      ? '<option value="general" selected>عام (المرحلة الإعدادية)</option><option value="both">عام لجميع طلاب الصف</option>'
      : '<option value="both" selected>مشترك (علمي وأدبي)</option><option value="scientific">القسم العلمي فقط</option><option value="literary">القسم الأدبي فقط</option>';
  }

  onEditLessonGradeChange() {
    const gradeEl = document.getElementById('editLessonGrade');
    const branchEl = document.getElementById('editLessonBranch');
    const subjEl = document.getElementById('editLessonSubject');
    if (!gradeEl || !branchEl) return;
    if (subjEl) subjEl.innerHTML = this.renderSubjectOptionsForGrade(gradeEl.value, subjEl.value);
    if (this.isPrepGrade(gradeEl.value)) {
      branchEl.innerHTML = '<option value="general" selected>عام (المرحلة الإعدادية)</option><option value="both">عام لجميع طلاب الصف</option>';
    } else {
      const prev = ['scientific', 'literary', 'both'].includes(branchEl.value) ? branchEl.value : 'both';
      branchEl.innerHTML = `<option value="both" ${prev === 'both' ? 'selected' : ''}>مشترك (علمي وأدبي)</option><option value="scientific" ${prev === 'scientific' ? 'selected' : ''}>القسم العلمي فقط</option><option value="literary" ${prev === 'literary' ? 'selected' : ''}>القسم الأدبي فقط</option>`;
    }
  }

  onLessonVideoTypeChange(videoType) {
    const localWrap = document.getElementById('localVideoUploadGroup');
    const bunnyWrap = document.getElementById('bunnyVideoIdGroup');
    const hlsWarn = document.getElementById('localVideoHlsWarning');
    if (!localWrap || !bunnyWrap) return;
    if (videoType === 'bunny') {
      localWrap.style.display = 'none';
      if (hlsWarn) hlsWarn.style.display = 'none';
      bunnyWrap.style.display = 'block';
    } else {
      localWrap.style.display = 'grid';
      if (hlsWarn) hlsWarn.style.display = 'block';
      bunnyWrap.style.display = 'none';
    }
  }

  initUiDeterrents() {
    document.addEventListener('contextmenu', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      this.showToast('تنبيه واجهة: المحتوى مخصص للعرض داخل منصة مَتْن.', 'warning');
    });
    document.addEventListener('keydown', (e) => {
      const key = e.key ? e.key.toLowerCase() : '';
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (mod && key === 'p' && this.user?.role === 'admin' && this.adminTab === 'vouchers') {
        return;
      }
      const isShortcut = e.key === 'F12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(key)) || (mod && ['u', 's', 'p'].includes(key));
      if (isShortcut) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerUiCurtain('تم إيقاف اختصارات الحفظ أو الطباعة في واجهة العرض');
        return false;
      }
    });
    document.addEventListener('visibilitychange', () => {
      const curtain = document.getElementById('videoSecurityCurtain');
      const vid = document.getElementById('protectedHtmlVideo');
      if (document.hidden && curtain) {
        curtain.classList.add('active');
        if (vid && !vid.paused) vid.pause();
      } else if (!document.hidden && curtain && !curtain.dataset.lockedByViolation) {
        curtain.classList.remove('active');
      }
    });
  }

  async triggerUiCurtain(reason) {
    this.showToast(reason, 'warning');
    const curtain = document.getElementById('videoSecurityCurtain');
    const vid = document.getElementById('protectedHtmlVideo');
    if (vid && !vid.paused) vid.pause();
    if (curtain) {
      curtain.dataset.lockedByViolation = '1';
      curtain.classList.add('active');
    }
    if (this.user) {
      try {
        await this.api('/api/security/report', { method: 'POST', body: JSON.stringify({ event_type: 'UI_DETERRENT', details: reason }) });
      } catch {}
    }
  }

  async api(endpoint, options = {}) {
    const csrf = this.csrfToken || this.getCookie('matn_csrf_token') || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-Device-Id': this.deviceId,
      'X-Device-Name': encodeURIComponent(this.deviceName),
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(endpoint, { ...options, credentials: 'same-origin', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'حدث خطأ غير متوقع');
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  showToast(message, type = 'gold') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const borderColors = { gold: '#d4b26a', success: '#10b981', danger: '#f43f5e', warning: '#f59e0b' };
    toast.style.cssText = `background:rgba(10,31,23,0.96); backdrop-filter:blur(12px); border:1.5px solid ${borderColors[type] || borderColors.gold}; color:#fff; padding:12px 16px; border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,0.55); font-weight:700; font-size:0.86rem; transition:opacity 0.25s, transform 0.25s; max-width:calc(100vw - 40px);`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 260);
    }, 3800);
  }

  stopAllVideos(exceptEl = null) {
    document.querySelectorAll('video, audio').forEach((mediaEl) => {
      if (mediaEl !== exceptEl) {
        try { if (!mediaEl.paused) mediaEl.pause(); } catch {}
      }
    });
  }

  destroyMediaInside(container) {
    if (!container) return;
    container.querySelectorAll('video, audio').forEach((mediaEl) => {
      try { mediaEl.pause(); mediaEl.removeAttribute('src'); mediaEl.load(); } catch {}
    });
  }

  openModal(html, maxWidth = '560px') {
    const modal = document.getElementById('globalModal');
    const content = document.getElementById('globalModalContent');
    this.stopAllVideos();
    this.destroyMediaInside(content);
    content.style.maxWidth = maxWidth;
    content.innerHTML = html;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
  }

  closeModal() {
    const modal = document.getElementById('globalModal');
    const content = document.getElementById('globalModalContent');
    this.destroyMediaInside(content);
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
    if (content) {
      content.style.maxWidth = '560px';
      content.innerHTML = '';
    }
  }

  stopActiveMediaLoops() {
    if (this.watermarkInterval) clearInterval(this.watermarkInterval);
    if (this.synthCanvasInterval) clearInterval(this.synthCanvasInterval);
    this.stopAllVideos();
  }

  async copyToClipboard(text, label = '') {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      this.showToast(`تم نسخ ${label || 'النص'}: ${text}`, 'success');
    } catch {
      this.showToast('تعذر النسخ التلقائي؛ يمكنك التحديد والنسخ يدوياً.', 'warning');
    }
  }

  async bootstrap() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    try {
      const pub = await this.api('/api/public/info');
      if (pub && pub.settings) {
        this.publicSettings = { ...this.publicSettings, ...pub.settings };
        this.syncPublicBrandingElements();
      }
      if (pub && pub.stats) this.publicStats = pub.stats;
      if (pub && pub.registration_mode) this.registrationMode = pub.registration_mode;
    } catch {}

    if (this.authToken || this.csrfToken || this.getCookie('matn_csrf_token')) {
      try {
        const res = await this.api('/api/auth/me');
        this.user = res.user;
        this.renderNavbar();
        if (this.user.role === 'admin') await this.loadAdminDashboard(false);
        else await this.loadStudentPortal(false);
        if (window.location.hash) this.applyHashRoute();
        return;
      } catch {
        this.user = null;
        this.clearAuthSession();
      }
    }

    this.renderNavbar();
    const initialHash = (window.location.hash || '').replace(/^#/, '');
    if (initialHash === '/login') this.renderLoginPage(false);
    else if (initialHash === '/register') this.renderRegisterPage(false);
    else if (initialHash === '/forgot-password') this.renderForgotPasswordPage(false);
    else this.renderLanding();
  }

  navigateHome() {
    this.closeMobileSidebar();
    this.stopActiveMediaLoops();
    if (this.examTimerInterval) clearInterval(this.examTimerInterval);
    this.activeAssessmentSession = null;
    this._isSubmittingAssessment = false;
    this.activeLessonId = null;
    if (this.user) {
      if (this.user.role === 'admin') {
        this.adminTab = 'lessons_list';
        this.setHashRoute('/admin');
        this.renderAdminDashboard();
      } else {
        this.studentTab = 'curriculum';
        this.setHashRoute('/dashboard');
        this.renderStudentPortal();
      }
    } else {
      this.setHashRoute('/');
      this.renderLanding();
    }
  }

  async logout() {
    this.closeMobileSidebar();
    this.stopActiveMediaLoops();
    if (this.examTimerInterval) clearInterval(this.examTimerInterval);
    this.activeAssessmentSession = null;
    this._isSubmittingAssessment = false;
    try { await this.api('/api/auth/logout', { method: 'POST' }); } catch {}
    this.clearAuthSession();
    this.user = null;
    this.activeLessonId = null;
    this.studentNotifications = [];
    this.notificationUnreadCount = 0;
    this.studentLiveSessions = [];
    this.setHashRoute('/');
    this.renderNavbar();
    this.renderLanding();
    this.showToast('تم تسجيل الخروج وإبطال الجلسة بنجاح.');
  }
}

registerAuthMethods(MatnPlatformApp.prototype);
registerStudentMethods(MatnPlatformApp.prototype);
registerAdminMethods(MatnPlatformApp.prototype);

window.addEventListener('DOMContentLoaded', () => {
  window.app = new MatnPlatformApp();
});
