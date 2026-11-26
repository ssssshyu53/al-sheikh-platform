import { SUBJECTS_META, GRADES_META, BRANCHES_META } from './constants.js';

export function registerStudentMethods(proto) {
  Object.assign(proto, {
    async loadStudentPortal(silent = false) {
      this.currentView = 'student_portal';
      const root = document.getElementById('appRoot');
      if (!silent && !this.studentDashboardData) {
        root.innerHTML = this.renderSkeletonView('جاري تجهيز منصتك التعليمية...');
      }

      try {
        const [data, notifRes, liveRes, mistakesRes] = await Promise.all([
          this.api('/api/student/dashboard'),
          this.api('/api/student/notifications').catch(() => ({ notifications: [], unread_count: 0 })),
          this.api('/api/student/live-sessions').catch(() => ({ sessions: [] })),
          this.api('/api/student/mistakes').catch(() => ({ mistakes: [], total_count: 0, subject_counts: {} }))
        ]);
        this.studentDashboardData = data;
        this.user = data.user;
        this.studentNotifications = Array.isArray(notifRes.notifications) ? notifRes.notifications : [];
        this.notificationUnreadCount = Number(notifRes.unread_count || 0);
        this.studentLiveSessions = Array.isArray(liveRes.sessions) ? liveRes.sessions : [];
        this.studentMistakesData = mistakesRes;
        this.renderNavbar();
        this.renderStudentPortal();
      } catch (err) {
        root.innerHTML = `<div class="container"><div class="section-card"><h3 style="color:var(--danger);">${this.esc(err.message)}</h3></div></div>`;
      }
    },

    switchStudentTab(tab, updateHash = true) {
      this.stopActiveMediaLoops();
      this.activeLessonId = null;
      this.studentTab = tab || 'curriculum';
      if (updateHash) {
        const map = {
          curriculum: '/dashboard',
          mistakes: '/mistakes',
          live: '/live',
          analytics: '/analytics',
          subscription: '/subscription'
        };
        this.setHashRoute(map[this.studentTab] || '/dashboard');
      }
      this.renderStudentPortal();
      if (this.studentTab === 'mistakes') {
        this.refreshStudentMistakes();
      }
    },

    async refreshStudentMistakes() {
      try {
        const res = await this.api('/api/student/mistakes');
        this.studentMistakesData = res;
        if (this.studentTab === 'mistakes' && !this.activeLessonId) {
          this.renderStudentPortal();
        }
      } catch {}
    },

    selectSubject(subj) {
      this.stopActiveMediaLoops();
      this.activeLessonId = null;
      this.selectedSubject = subj;
      this.lessonUnitFilter = 'all';
      this.studentTab = 'curriculum';
      this.setHashRoute('/dashboard');
      this.renderStudentPortal();
    },

    resetLessonFilters() {
      this.lessonQuery = '';
      this.lessonUnitFilter = 'all';
      this.lessonStatusFilter = 'all';
      this.renderStudentPortal();
    },

    filterMistakesSubject(subj) {
      this.mistakeSubjectFilter = subj || 'all';
      this.mistakePracticeAnswers = {};
      this.renderStudentPortal();
    },

    startMistakePractice() {
      this.mistakePracticeMode = !this.mistakePracticeMode;
      this.mistakePracticeAnswers = {};
      this.renderStudentPortal();
    },

    resetMistakePractice() {
      this.mistakePracticeAnswers = {};
      this.renderStudentPortal();
    },

    selectPracticeOption(questionKeyId, optionIdx) {
      const mistakes = this.getFilteredMistakesList();
      const target = mistakes.find((m, i) => (m.question_id || (100000 + i)) === questionKeyId);
      if (!target || !Array.isArray(target.options)) return;
      this.mistakePracticeAnswers[questionKeyId] = target.options[optionIdx];
      this.renderStudentPortal();
    },

    getFilteredMistakesList() {
      const list = Array.isArray(this.studentMistakesData?.mistakes) ? this.studentMistakesData.mistakes : [];
      if (!this.mistakeSubjectFilter || this.mistakeSubjectFilter === 'all') return list;
      return list.filter((m) => m.subject === this.mistakeSubjectFilter);
    },

    async openNotificationsModal() {
      try {
        const res = await this.api('/api/student/notifications');
        this.studentNotifications = res.notifications || [];
        this.notificationUnreadCount = Number(res.unread_count || 0);
        this.renderNavbar();
      } catch {}

      const list = this.studentNotifications || [];
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.1rem; display:flex; align-items:center; gap:8px;">${this.icon('bell', 18)} <span>الإشعارات والتنبيهات</span></h3>
          <div style="display:flex; gap:6px;">
            ${this.notificationUnreadCount > 0 ? `<button type="button" class="btn btn-emerald btn-sm" data-click="markAllNotificationsRead">${this.icon('check-circle', 14)} <span>تحديد الكل كمقروء</span></button>` : ''}
            <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">${this.icon('x', 14)} <span>إغلاق</span></button>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px; max-height:65vh; overflow-y:auto;">
          ${list.length === 0 ? `<div style="text-align:center; padding:24px; color:var(--text-secondary);">لا توجد إشعارات جديدة حالياً.</div>` : list.map((n) => `
            <div style="background:var(--bg-card); border:1px solid ${n.is_read ? 'var(--border-subtle)' : 'var(--gold-400)'}; border-radius:12px; padding:12px;">
              <div class="card-meta-row" style="margin-bottom:4px;">
                <span style="font-weight:800; color:var(--gold-300); font-size:0.9rem;">${this.esc(n.title)}</span>
                ${!n.is_read ? `<span class="badge badge-danger">جديد</span>` : `<span class="badge badge-success">مقروء</span>`}
              </div>
              <div style="font-size:0.83rem; color:var(--text-secondary); line-height:1.6;">${this.esc(n.body)}</div>
              <div style="font-size:0.72rem; color:var(--text-muted); margin-top:6px;">${this.esc(new Date(n.created_at).toLocaleString('ar-EG'))}</div>
            </div>
          `).join('')}
        </div>
      `, '600px');
    },

    async markAllNotificationsRead() {
      try {
        const res = await this.api('/api/student/notifications/read', {
          method: 'POST',
          body: JSON.stringify({})
        });
        this.studentNotifications = res.notifications || [];
        this.notificationUnreadCount = Number(res.unread_count || 0);
        this.renderNavbar();
        this.openNotificationsModal();
        this.showToast('تم تحديد جميع الإشعارات كمقروءة.', 'success');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async joinLiveSession(sessionId) {
      try {
        const res = await this.api(`/api/student/live-sessions/${Number(sessionId)}/join`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        this.showToast(res.message, 'success');
        const safeUrl = this.safeHttpsUrl(res.stream_url);
        if (safeUrl) {
          window.open(safeUrl, '_blank', 'noopener,noreferrer');
        }
        await this.loadStudentPortal(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async openLessonWorkspace(lessonId, defaultSubTab = 'video', updateHash = true) {
      this.stopActiveMediaLoops();
      this.closeModal();

      try {
        const ticketRes = await this.api(`/api/media/ticket/${Number(lessonId)}`, { method: 'POST' });
        this.currentStreamTicket = ticketRes.ticket;
        this.currentBunnyEmbedUrl = ticketRes.bunny_embed_url || null;
        this.activeLessonId = Number(lessonId);
        this.activeLessonSubTab = defaultSubTab;
        this.activeLessonNotes = [];
        if (updateHash) this.setHashRoute(`/lesson/${Number(lessonId)}`);

        if (this.user && this.user.role === 'admin') {
          this.renderAdminDashboard();
        } else {
          this.renderStudentPortal();
        }
        this.initLessonMediaAfterRender(Number(lessonId), defaultSubTab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    switchLessonSubTab(subTab) {
      if (!this.activeLessonId) return;
      this.openLessonWorkspace(this.activeLessonId, subTab);
    },

    renderStudentPortal() {
      const root = document.getElementById('appRoot');
      const u = this.user;
      const supportWaUrl = this.formatSupportWaUrl('السلام عليكم، أحتاج مساعدة في منصة متن');
      const liveCount = (this.studentLiveSessions || []).filter((s) => s.status !== 'ended' && s.status !== 'cancelled').length;
      const mistakesCount = Number(this.studentMistakesData?.total_count || 0);
      const unread = Number(this.notificationUnreadCount || 0);

      this.mobileDrawerOpen = false;
      document.body.classList.remove('drawer-open');

      root.innerHTML = `
        <div class="app-shell ${this.sidebarCollapsed ? 'sidebar-collapsed' : ''} fade-in">
          <div id="sidebarDrawerBackdrop" class="sidebar-drawer-backdrop" data-click="closeMobileSidebar" aria-hidden="true"></div>
          <aside class="app-sidebar" aria-label="قائمة الطالب">
            <div class="sidebar-header">
              <div class="sidebar-profile">
                <img src="/assets/logo.png" alt="شعار منصة متن" class="sidebar-profile-avatar" />
                <div class="sidebar-profile-meta">
                  <strong class="sidebar-profile-name">${this.esc(u.full_name)}</strong>
                  <span class="sidebar-profile-sub">${this.esc(GRADES_META[u.grade] || '')} · ${this.esc(BRANCHES_META[u.branch] || '')}</span>
                  <span class="sidebar-status-line ${u.subscription_active ? 'is-active' : 'is-expired'}">
                    ${this.icon(u.subscription_active ? 'check-circle' : 'alert-triangle', 12)}
                    <span>${u.subscription_active ? `اشتراك سارٍ · ${Number(u.days_remaining)} يوم` : 'غير مشترك'}</span>
                  </span>
                </div>
                <button type="button" class="sidebar-collapse-btn" data-click="toggleDesktopSidebar" aria-expanded="${!this.sidebarCollapsed}" title="${this.sidebarCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}" aria-label="طي أو توسيع القائمة الجانبية">
                  ${this.icon('chevron-right', 16)}
                </button>
                <button type="button" class="sidebar-drawer-close" data-click="closeMobileSidebar" aria-label="إغلاق القائمة">
                  ${this.icon('x', 16)}
                </button>
              </div>
            </div>

            <div class="sidebar-scroll-body">
              <div class="sidebar-group">
                <div class="sidebar-group-label">القائمة الرئيسية</div>
                <nav class="sidebar-nav">
                  <button type="button" class="sidebar-link ${this.studentTab === 'curriculum' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="curriculum" title="المنهج والمحاضرات">
                    <span class="nav-icon">${this.icon('book', 17)}</span>
                    <span class="sidebar-link-label">المنهج والمحاضرات</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.studentTab === 'mistakes' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="mistakes" title="بنك الأخطاء">
                    <span class="nav-icon">${this.icon('target', 17)}</span>
                    <span class="sidebar-link-label">بنك الأخطاء</span>
                    ${mistakesCount > 0 ? `<span class="sidebar-count">${mistakesCount}</span>` : ''}
                  </button>
                  <button type="button" class="sidebar-link ${this.studentTab === 'live' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="live" title="الحصص المباشرة">
                    <span class="nav-icon">${this.icon('radio', 17)}</span>
                    <span class="sidebar-link-label">الحصص المباشرة</span>
                    ${liveCount > 0 ? `<span class="sidebar-count is-accent">${liveCount}</span>` : ''}
                  </button>
                  <button type="button" class="sidebar-link ${this.studentTab === 'analytics' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="analytics" title="درجاتي والمستوى">
                    <span class="nav-icon">${this.icon('bar-chart', 17)}</span>
                    <span class="sidebar-link-label">درجاتي والمستوى</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.studentTab === 'subscription' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="subscription" title="الاشتراك وشحن الكود">
                    <span class="nav-icon">${this.icon('ticket', 17)}</span>
                    <span class="sidebar-link-label">الاشتراك وشحن الكود</span>
                  </button>
                  <button type="button" class="sidebar-link" data-click="openNotificationsModal" title="الإشعارات">
                    <span class="nav-icon">${this.icon('bell', 17)}</span>
                    <span class="sidebar-link-label">الإشعارات</span>
                    ${unread > 0 ? `<span class="sidebar-count is-danger">${unread}</span>` : ''}
                  </button>
                </nav>
              </div>

              <div class="sidebar-group">
                <div class="sidebar-group-label">المواد الشرعية المقررة</div>
                <div class="sidebar-nav">
                  ${this.getSubjectsForGrade(u.grade).map((key) => {
                    const meta = SUBJECTS_META[key];
                    const subjCount = (this.studentDashboardData?.lessons || []).filter((l) => l.subject === key).length;
                    const subjTitle = this.getSubjectName(key, u.grade);
                    return `
                      <button type="button" class="sidebar-link ${this.selectedSubject === key && this.studentTab === 'curriculum' && !this.activeLessonId ? 'is-sub-active' : ''}" data-click="selectSubject" data-arg="${key}" title="${this.esc(subjTitle)}">
                        <span class="nav-icon">${this.icon(meta.iconName || 'book', 16)}</span>
                        <span class="sidebar-link-label">${this.esc(subjTitle)}</span>
                        ${subjCount > 0 ? `<span class="sidebar-count">${subjCount}</span>` : ''}
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>

            <div class="sidebar-footer">
              ${supportWaUrl ? `<a href="${this.esc(supportWaUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm btn-block sidebar-support-btn" title="تواصل مع الدعم">${this.icon('message-circle', 15)} <span class="sidebar-footer-label">تواصل مع الدعم</span></a>` : ''}
              <div class="sidebar-security-note">
                ${this.icon('lock', 13)} <span class="sidebar-footer-label">الحساب مربوط بجهاز واحد</span>
              </div>
            </div>
          </aside>

          <section class="app-main">
            ${this.activeLessonId ? this.renderUnifiedLessonWorkspace(this.activeLessonId) : this.renderActiveStudentView()}
          </section>

          <nav class="mobile-bottom-nav">
            <button class="mobile-nav-item ${this.studentTab === 'curriculum' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="curriculum">
              <span>${this.icon('book', 18)}</span>
              <span>الرئيسية</span>
            </button>
            <button class="mobile-nav-item ${this.studentTab === 'live' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="live">
              <span>${this.icon('radio', 18)}</span>
              <span>مباشر</span>
            </button>
            <button class="mobile-nav-item ${this.studentTab === 'mistakes' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="mistakes">
              <span>${this.icon('target', 18)}</span>
              <span>أخطائي</span>
            </button>
            <button class="mobile-nav-item ${this.studentTab === 'analytics' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="analytics">
              <span>${this.icon('bar-chart', 18)}</span>
              <span>درجاتي</span>
            </button>
            <button class="mobile-nav-item ${this.studentTab === 'subscription' && !this.activeLessonId ? 'active' : ''}" data-click="switchStudentTab" data-arg="subscription">
              <span>${this.icon('ticket', 18)}</span>
              <span>حسابي</span>
            </button>
          </nav>
        </div>
      `;
    },

    renderGamificationAndCountdownStrip() {
      const data = this.studentDashboardData || {};
      const streak = Number(data.study_streak || 0);
      const badges = Array.isArray(data.badges) ? data.badges : [];
      const examDateRaw = String(data.azhar_exam_date || this.publicSettings?.azhar_exam_date || '').trim();
      let countdownHtml = '';

      if (examDateRaw) {
        const targetMs = new Date(`${examDateRaw}T09:00:00`).getTime();
        const diffDays = Number.isNaN(targetMs) ? null : Math.ceil((targetMs - Date.now()) / 86400000);
        if (diffDays !== null) {
          countdownHtml = `
            <div class="streak-card">
              <div style="width:46px; height:46px; border-radius:12px; background:rgba(16,185,129,0.16); color:var(--emerald-accent); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                ${this.icon('calendar', 24)}
              </div>
              <div>
                <div style="font-size:0.78rem; color:var(--text-secondary);">العد التنازلي لامتحانات الأزهر</div>
                <div style="font-size:1.15rem; font-weight:900; color:var(--gold-400);">
                  ${diffDays > 0 ? `متبقي ${diffDays} يوماً` : (diffDays === 0 ? 'اليوم بداية الامتحانات' : 'بدأت فترة الامتحانات')}
                </div>
                <div style="font-size:0.74rem; color:var(--text-muted);">الموعد المحدد: ${this.esc(examDateRaw)}</div>
              </div>
            </div>
          `;
        }
      }

      return `
        <div class="gamification-strip">
          <div class="streak-card">
            <div style="width:46px; height:46px; border-radius:12px; background:rgba(245,158,11,0.16); color:#f59e0b; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              ${this.icon('flame', 24)}
            </div>
            <div>
              <div style="font-size:0.78rem; color:var(--text-secondary);">سلسلة المذاكرة المتتالية</div>
              <div style="font-size:1.15rem; font-weight:900; color:var(--gold-400);">${streak} ${streak === 1 ? 'يوم' : 'أيام'} متتالية</div>
              <div style="font-size:0.74rem; color:var(--text-muted);">استمر بالمذاكرة يومياً للحفاظ على تقدمك</div>
            </div>
          </div>

          ${countdownHtml}

          <div class="streak-card" style="display:block;">
            <div style="font-size:0.8rem; font-weight:800; color:var(--gold-400); display:flex; align-items:center; gap:6px;">
              ${this.icon('award', 16)} <span>شارات الإنجاز</span>
            </div>
            <div class="badge-chip-list">
              ${badges.map((b) => `
                <span class="badge-chip ${b.unlocked ? '' : 'locked'}" title="${this.esc(b.description)}">
                  ${this.icon(b.icon || 'award', 14)}
                  <span>${this.esc(b.title)}</span>
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    },

    renderStudentAnalyticsCharts(data) {
      const subs = Array.isArray(data.submissions) ? [...data.submissions].reverse().slice(-10) : [];
      const lessons = Array.isArray(data.lessons) ? data.lessons : [];

      let chartSvg = `<div style="font-size:0.84rem; color:var(--text-secondary); padding:16px 0;">ابدأ بحل أول اختبار ليظهر منحنى تطور درجاتك هنا.</div>`;
      if (subs.length > 0) {
        const w = 620;
        const h = 190;
        const padX = 36;
        const padY = 24;
        const innerW = w - padX * 2;
        const innerH = h - padY * 2;
        const pts = subs.map((s, idx) => {
          const x = subs.length === 1 ? padX + innerW / 2 : padX + (idx / (subs.length - 1)) * innerW;
          const pct = Math.min(100, Math.max(0, Number(s.percentage || 0)));
          const y = padY + innerH - (pct / 100) * innerH;
          return { x, y, pct, label: s.assessment_title || `اختبار ${idx + 1}` };
        });
        const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        chartSvg = `
          <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block;" role="img" aria-label="منحنى تطور درجات الطالب">
            <line x1="${padX}" y1="${padY}" x2="${w - padX}" y2="${padY}" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="4 4"/>
            <line x1="${padX}" y1="${padY + innerH / 2}" x2="${w - padX}" y2="${padY + innerH / 2}" stroke="currentColor" stroke-opacity="0.16" stroke-dasharray="4 4"/>
            <line x1="${padX}" y1="${padY + innerH}" x2="${w - padX}" y2="${padY + innerH}" stroke="currentColor" stroke-opacity="0.25"/>
            <text x="8" y="${padY + 4}" font-size="11" fill="currentColor" opacity="0.65">100%</text>
            <text x="12" y="${padY + innerH / 2 + 4}" font-size="11" fill="currentColor" opacity="0.65">50%</text>
            ${pts.length > 1 ? `<polyline fill="none" stroke="var(--emerald-accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${poly}" />` : ''}
            ${pts.map((p) => `
              <g>
                <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="var(--gold-500)" stroke="var(--bg-main)" stroke-width="2">
                  <title>${this.esc(p.label)}: ${p.pct}%</title>
                </circle>
                <text x="${p.x.toFixed(1)}" y="${Math.max(14, p.y - 10).toFixed(1)}" font-size="11" font-weight="bold" text-anchor="middle" fill="var(--gold-300)">${p.pct}%</text>
              </g>
            `).join('')}
          </svg>
        `;
      }

      const subjectKeys = this.getSubjectsForGrade(this.user.grade);
      const subjectBarsHtml = subjectKeys.map((key) => {
        const subLessons = lessons.filter((l) => l.subject === key);
        const avgWatch = subLessons.length > 0
          ? Math.round(subLessons.reduce((acc, l) => acc + Number(l.progress?.max_watched_percent || 0), 0) / subLessons.length)
          : 0;
        const subExams = (data.submissions || []).filter((s) => s.subject === key);
        const avgScore = subExams.length > 0
          ? Math.round(subExams.reduce((acc, s) => acc + Number(s.percentage || 0), 0) / subExams.length)
          : null;
        return `
          <div style="margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; font-size:0.82rem; margin-bottom:5px; gap:8px;">
              <span style="font-weight:800; color:var(--text-primary);">${this.esc(this.getSubjectName(key, this.user.grade))}</span>
              <span style="color:var(--gold-300); font-weight:700;">إنجاز الحصص: ${avgWatch}% ${avgScore !== null ? `• متوسط الاختبارات: ${avgScore}%` : ''}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${Math.min(100, avgWatch)}%;"></div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="grid-2" style="margin-bottom:18px;">
          <div class="chart-card">
            <h4 style="color:var(--gold-400); font-size:0.95rem; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              ${this.icon('bar-chart', 17)} <span>تطور درجاتك عبر الامتحانات الأخيرة</span>
            </h4>
            ${chartSvg}
          </div>
          <div class="chart-card">
            <h4 style="color:var(--gold-400); font-size:0.95rem; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
              ${this.icon('target', 17)} <span>نسبة الإنجاز والمستوى في كل مادة</span>
            </h4>
            ${subjectBarsHtml}
          </div>
        </div>
      `;
    },

    renderMistakeBankTab() {
      const rawCount = Number(this.studentMistakesData?.total_count || 0);
      const subjectCounts = this.studentMistakesData?.subject_counts || {};
      const mistakes = this.getFilteredMistakesList();
      const availableSubjects = Object.keys(subjectCounts);

      return `
        <div class="fade-in">
          <div class="section-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">${this.icon('target', 20)} <span>بنك الأخطاء والمراجعة الذكية (${mistakes.length})</span></h3>
                <p style="font-size:0.82rem; color:var(--text-secondary);">يجمع تلقائياً كل الأسئلة التي أخطأت فيها في الامتحانات والواجبات المسموح بمراجعتها للتدرب عليها من جديد</p>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                ${mistakes.length > 0 ? `
                  <button type="button" class="btn ${this.mistakePracticeMode ? 'btn-danger' : 'btn-gold'} btn-sm" data-click="startMistakePractice">
                    ${this.icon(this.mistakePracticeMode ? 'x' : 'zap', 15)}
                    <span>${this.mistakePracticeMode ? 'إنهاء وضع التدريب' : 'إعادة التدريب على أخطائي'}</span>
                  </button>
                ` : ''}
              </div>
            </div>

            ${availableSubjects.length > 0 ? `
              <div class="tabs-bar" style="margin-bottom:16px;">
                <button class="tab-btn ${this.mistakeSubjectFilter === 'all' ? 'active' : ''}" data-click="filterMistakesSubject" data-arg="all">
                  <span>كل المواد (${rawCount})</span>
                </button>
                ${availableSubjects.map((sk) => `
                  <button class="tab-btn ${this.mistakeSubjectFilter === sk ? 'active' : ''}" data-click="filterMistakesSubject" data-arg="${this.esc(sk)}">
                    <span>${this.esc(this.getSubjectName(sk, this.user.grade))} (${Number(subjectCounts[sk] || 0)})</span>
                  </button>
                `).join('')}
              </div>
            ` : ''}

            ${mistakes.length === 0 ? `
              <div style="text-align:center; padding:42px 20px; color:var(--text-secondary);">
                <div style="color:var(--emerald-accent); margin-bottom:10px;">${this.icon('check-circle', 38)}</div>
                <h4 style="color:var(--gold-400); margin-bottom:6px;">سجلك خالٍ من الأخطاء المراجعة حالياً</h4>
                <p style="font-size:0.84rem;">أحسنت! استمر في حل الواجبات والامتحانات، وأي سؤال تخطئ فيه سيظهر هنا فور إتاحة مراجعته.</p>
              </div>
            ` : `
              ${this.mistakePracticeMode ? `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 14px; border-radius:12px; background:var(--bg-card); border:1px solid var(--border-gold);">
                  <span style="font-weight:800; color:var(--gold-300); font-size:0.86rem;">وضع التدريب التفاعلي: اختر الإجابة الصحيحة لترى النتيجة الفورية</span>
                  <button type="button" class="btn btn-outline-gold btn-sm" data-click="resetMistakePractice">${this.icon('refresh', 14)} <span>تصفير المحاولة</span></button>
                </div>
              ` : ''}
              <div style="display:flex; flex-direction:column; gap:12px;">
                ${mistakes.map((m, idx) => {
                  const qKey = m.question_id || (100000 + idx);
                  const chosen = this.mistakePracticeAnswers[qKey];
                  const practiceDone = chosen !== undefined;
                  const practiceCorrect = practiceDone && String(chosen).trim() === String(m.correct_option).trim();

                  return `
                    <div class="question-box" style="margin-bottom:0; border-color:${practiceDone ? (practiceCorrect ? 'var(--emerald-accent)' : 'var(--danger)') : 'var(--border-subtle)'};">
                      <div class="card-meta-row">
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                          <span class="badge badge-gold">${this.esc(this.getSubjectName(m.subject, m.grade))}</span>
                          <span class="badge badge-danger">${this.esc(m.topic_tag)}</span>
                        </div>
                        <span style="font-size:0.76rem; color:var(--text-muted);">${this.esc(m.lesson_title)} — ${this.esc(m.assessment_title)}</span>
                      </div>
                      <h4 style="font-size:0.98rem; color:var(--text-primary); margin-bottom:10px;">${idx + 1}. ${this.esc(m.question_text)}</h4>

                      ${this.mistakePracticeMode ? `
                        <div class="${m.question_type === 'true_false' ? 'grid-2' : ''}">
                          ${(m.options || []).map((opt, oIdx) => {
                            const isPicked = chosen === opt;
                            return `
                              <div class="option-label ${isPicked ? 'selected' : ''}" data-click="selectPracticeOption" data-id="${Number(qKey)}" data-oindex="${oIdx}">
                                <span class="option-letter-circle">${['أ', 'ب', 'ج', 'د'][oIdx] || oIdx + 1}</span>
                                <span style="flex:1;">${this.esc(opt)}</span>
                              </div>
                            `;
                          }).join('')}
                        </div>
                        ${practiceDone ? `
                          <div style="margin-top:10px; padding:10px; border-radius:10px; background:${practiceCorrect ? 'rgba(16,185,129,0.14)' : 'rgba(244,63,94,0.14)'}; font-size:0.84rem;">
                            <b style="color:${practiceCorrect ? 'var(--success-text)' : 'var(--danger-text)'};">
                              ${practiceCorrect ? 'أحسنت! إجابة صحيحة الآن.' : `ما زالت غير صحيحة — الإجابة الصحيحة هي: ${this.esc(m.correct_option)}`}
                            </b>
                            ${m.explanation ? `<div style="margin-top:4px; color:var(--gold-300);">${this.esc(m.explanation)}</div>` : ''}
                          </div>
                        ` : ''}
                      ` : `
                        <div style="font-size:0.84rem; margin-bottom:4px; color:var(--danger-text);">إجابتك السابقة: <b>${this.esc(m.selected_option)}</b></div>
                        <div style="font-size:0.84rem; margin-bottom:4px; color:var(--success-text);">الإجابة الصحيحة: <b>${this.esc(m.correct_option)}</b></div>
                        ${m.explanation ? `
                          <div style="background:rgba(212,178,106,0.1); border-right:3px solid var(--gold-400); padding:8px 12px; border-radius:6px; font-size:0.82rem; color:var(--gold-300); margin-top:8px;">
                            التوضيح الشرعي: ${this.esc(m.explanation)}
                          </div>
                        ` : ''}
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    },

    renderActiveStudentView() {
      const u = this.user;
      const data = this.studentDashboardData;

      if (this.studentTab === 'mistakes') {
        return this.renderMistakeBankTab();
      }

      if (this.studentTab === 'live') {
        const liveList = this.studentLiveSessions || [];
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon('radio', 20)} <span>الحصص المباشرة والبث التفاعلي</span></h3>
                  <p style="font-size:0.82rem; color:var(--text-secondary);">روابط الحصص محمية وتفتح تلقائياً للمشتركين قبل الموعد مباشرة مع تسجيل الحضور</p>
                </div>
              </div>
              ${liveList.length === 0 ? `
                <div style="text-align:center; padding:36px; color:var(--text-secondary);">لا توجد حصص مباشرة مجدولة لصفك حالياً.</div>
              ` : `
                <div class="grid-2">
                  ${liveList.map((s) => `
                    <div class="lesson-card">
                      <div>
                        <div class="card-meta-row">
                          <span class="badge ${s.status === 'live' ? 'badge-danger' : 'badge-gold'}">${this.icon('radio', 13)} <span>${s.status === 'live' ? 'مباشر الآن' : 'مجدولة'}</span></span>
                          <span class="badge badge-success">${this.esc(this.getSubjectName(s.subject, s.grade))}</span>
                        </div>
                        <h4 style="color:var(--gold-400); margin-bottom:6px;">${this.esc(s.title)}</h4>
                        <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:8px;">${this.esc(s.description || 'بث مباشر لشرح المادة والإجابة على استفسارات الطلاب.')}</p>
                        <div style="font-size:0.8rem; color:var(--gold-300); margin-bottom:10px; display:flex; align-items:center; gap:6px;">
                          ${this.icon('clock', 14)} <span>الموعد: <b>${this.esc(new Date(s.starts_at).toLocaleString('ar-EG'))}</b> (${Number(s.duration_minutes)} دقيقة)</span>
                        </div>
                        ${s.attended ? `<div style="margin-bottom:8px;"><span class="badge badge-success">${this.icon('check-circle', 13)} <span>تم تسجيل حضورك</span></span></div>` : ''}
                      </div>
                      ${s.can_join ? `
                        <button type="button" class="btn btn-gold" style="width:100%;" data-click="joinLiveSession" data-id="${Number(s.id)}">
                          ${this.icon('video', 16)} <span>دخول الحصة المباشرة الآن (${this.esc(s.provider)})</span>
                        </button>
                      ` : `
                        <div style="background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.35); padding:10px; border-radius:10px; font-size:0.8rem; color:var(--danger-text); display:flex; align-items:center; gap:6px;">
                          ${this.icon('lock', 14)} <span>${this.esc(s.lock_reason || 'الرابط غير متاح حالياً')}</span>
                        </div>
                      `}
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        `;
      }

      if (this.studentTab === 'analytics') {
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <h3 class="section-title">${this.icon('bar-chart', 20)} <span>تقرير المستوى وتحليل نقاط الضعف والقوة</span></h3>
              </div>

              ${this.renderStudentAnalyticsCharts(data)}

              <div class="grid-2" style="margin-bottom:18px;">
                <div class="stat-box" style="border-color:rgba(244,63,94,0.4);">
                  <div style="font-weight:800; color:var(--danger-text); margin-bottom:6px; font-size:0.9rem; display:flex; align-items:center; gap:6px;">
                    ${this.icon('alert-triangle', 16)} <span>مباحث شرعية تحتاج مراجعة (نقاط الضعف):</span>
                  </div>
                  ${data.weakness_summary.length === 0 ? `
                    <div style="color:var(--success-text); font-size:0.86rem;">لا توجد نقاط ضعف مسجلة! مستواك ممتاز في جميع المباحث.</div>
                  ` : `
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      ${data.weakness_summary.map((w) => `<span class="badge badge-danger">${this.esc(w.topic)} (${Number(w.count)})</span>`).join('')}
                    </div>
                  `}
                </div>

                <div class="stat-box" style="border-color:rgba(16,185,129,0.4);">
                  <div style="font-weight:800; color:var(--success-text); margin-bottom:6px; font-size:0.9rem; display:flex; align-items:center; gap:6px;">
                    ${this.icon('award', 16)} <span>مباحث شرعية متقنة (نقاط القوة):</span>
                  </div>
                  ${data.strength_summary.length === 0 ? `
                    <div style="color:var(--text-secondary); font-size:0.86rem;">ابدأ بحل الواجبات والامتحانات ليظهر تحليل إتقانك للمباحث.</div>
                  ` : `
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      ${data.strength_summary.map((s) => `<span class="badge badge-success">${this.icon('check-circle', 12)} ${this.esc(s.topic)}</span>`).join('')}
                    </div>
                  `}
                </div>
              </div>

              ${data.submissions.length === 0 ? `
                <p style="color:var(--text-secondary); text-align:center; padding:24px;">لم تقم بتسليم أي واجب أو امتحان حتى الآن.</p>
              ` : `
                <div class="table-responsive">
                  <table class="matn-table">
                    <thead>
                      <tr>
                        <th>الاختبار / الواجب</th>
                        <th>المادة والحصة</th>
                        <th>الدرجة</th>
                        <th>النسبة</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.submissions.map((s) => `
                        <tr>
                          <td style="font-weight:700;">${this.esc(s.assessment_title)}</td>
                          <td>${this.esc(SUBJECTS_META[s.subject] ? SUBJECTS_META[s.subject].name : s.subject)} — ${this.esc(s.lesson_title)}</td>
                          <td style="font-weight:800; color:var(--gold-400);">${Number(s.score)} / ${Number(s.total_points)}</td>
                          <td>${Number(s.percentage)}%</td>
                          <td>
                            <span class="badge ${s.passed ? 'badge-success' : 'badge-danger'}">
                              ${s.passed ? 'ناجح (فوق النصف)' : 'راسب (ينتظر الملحق)'}
                            </span>
                          </td>
                          <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                              ${s.review_allowed
                                ? `<button class="btn btn-outline-gold btn-sm" data-click="viewSubmissionReview" data-id="${Number(s.id)}">${this.icon('book-open', 13)} <span>نموذج الإجابة</span></button>`
                                : `<span class="badge badge-gold">بعد انتهاء الموعد</span>`}
                              ${Number(s.percentage) >= 90 ? `
                                <button class="btn btn-gold btn-sm" data-click="downloadCertificate" data-id="${Number(s.id)}">${this.icon('award', 13)} <span>شهادة التقدير</span></button>
                              ` : ''}
                            </div>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>
        `;
      }

      if (this.studentTab === 'subscription') {
        const supportWaOrder = this.formatSupportWaUrl(`السلام عليكم، أنا الطالب (${u.full_name || ''})، أريد طلب كود اشتراك في منصة مَتْن`);
        return `
          <div class="fade-in">
            <div class="section-card" style="max-width:640px; margin:0 auto;">
              <div style="text-align:center; margin-bottom:20px;">
                <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('ticket', 38)}</div>
                <h3 style="color:var(--gold-400); font-size:1.25rem;">إدارة اشتراكك الشهري وشحن الكود</h3>
                <p style="font-size:0.86rem; color:var(--text-secondary);">كل كود شحن يفتح لك محتوى المنصة لمدة ٣٠ يوماً كاملة من لحظة تفعيله</p>
              </div>

              <div class="stat-box" style="text-align:center; margin-bottom:20px; border-color:var(--border-gold);">
                ${u.subscription_active ? `
                  <div style="font-size:0.84rem; color:var(--text-secondary);">حالة الاشتراك الحالي</div>
                  <div style="font-size:1.45rem; font-weight:900; color:var(--success-text);">نشط — متبقٍ ${Number(u.days_remaining)} يوماً</div>
                  <div style="font-size:0.8rem; color:var(--gold-300);">ينتهي في: ${this.esc(new Date(u.subscription_expires_at).toLocaleDateString('ar-EG'))}</div>
                ` : `
                  <div style="font-size:1.05rem; font-weight:800; color:var(--danger-text);">لا يوجد اشتراك شهري نشط حالياً</div>
                `}
              </div>

              <form data-submit="handleRedeemVoucher">
                <div class="form-group">
                  <label>أدخل كود كارت الشحن لتفعيل أو تجديد ٣٠ يوماً</label>
                  <input type="text" name="voucher_code" id="tabVoucherCodeInput" class="form-control" placeholder="MATN-30D-XXXXXXXXXXXX" style="text-align:center; font-size:1.15rem; font-weight:800; letter-spacing:1.5px;" required />
                </div>
                <button type="submit" class="btn btn-gold" style="width:100%; padding:13px;">${this.icon('zap', 16)} <span>شحن وتفعيل الكود الآن</span></button>
              </form>

              <div style="margin-top:14px;">
                ${this.renderPaymentChannelsBox()}
                ${supportWaOrder ? `<a href="${this.esc(supportWaOrder)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" style="width:100%; margin-top:8px;">${this.icon('message-circle', 15)} <span>تواصل مع الدعم لطلب كود شحن جديد</span></a>` : ''}
              </div>
            </div>
          </div>
        `;
      }

      const visibleSubjects = this.getSubjectsForGrade(u.grade);
      if (!visibleSubjects.includes(this.selectedSubject)) {
        this.selectedSubject = visibleSubjects[0];
      }
      const activeSubjectName = this.getSubjectName(this.selectedSubject, u.grade);
      const subjectLessonsAll = data.lessons.filter((l) => l.subject === this.selectedSubject);
      const uniqueUnits = Array.from(new Set(subjectLessonsAll.map((l) => String(l.unit_title || '').trim()).filter(Boolean)));
      const qTerm = String(this.lessonQuery || '').trim().toLowerCase();

      const filteredLessons = subjectLessonsAll.filter((l) => {
        if (qTerm) {
          const hay = `${l.title || ''} ${l.description || ''} ${l.unit_title || ''}`.toLowerCase();
          if (!hay.includes(qTerm)) return false;
        }
        if (this.lessonUnitFilter !== 'all' && String(l.unit_title || '') !== this.lessonUnitFilter) {
          return false;
        }
        const pct = Number(l.progress?.max_watched_percent || 0);
        if (this.lessonStatusFilter === 'completed' && pct < 80) return false;
        if (this.lessonStatusFilter === 'incomplete' && pct >= 80) return false;
        if (this.lessonStatusFilter === 'unlocked' && !l.unlocked) return false;
        return true;
      });

      const retakeBannerHtml = (data.scheduled_retakes && data.scheduled_retakes.length > 0) ? `
        <div class="section-card" style="border-color:#f59e0b; background:linear-gradient(135deg, rgba(120,53,15,0.28), var(--bg-surface));">
          <div class="card-meta-row" style="margin-bottom:0;">
            <div style="flex:1; min-width:220px;">
              <span class="badge badge-danger">${this.icon('alert-triangle', 13)} <span>تنبيه امتحان الإعادة (الملحق)</span></span>
              <h3 style="color:var(--gold-400); margin-top:6px; font-size:1.08rem;">تم فتح موعد «امتحان الراسبين» من قِبل الأستاذ</h3>
              <p style="font-size:0.82rem; color:var(--text-secondary);">اجتز الامتحان بمجموع فوق النصف لفتح المحاضرات التالية.</p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${data.scheduled_retakes.map((rt) => `
                <button class="btn btn-gold btn-sm" data-click="startAssessment" data-id="${Number(rt.id)}">
                  ${this.icon('edit', 14)} <span>دخول ${this.esc(rt.title)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      ` : '';

      const honorRollHtml = (data.honor_roll_enabled && Array.isArray(data.honor_roll) && data.honor_roll.length > 0) ? `
        <div class="section-card" style="border-color:var(--gold-400); background:linear-gradient(135deg, rgba(212,178,106,0.1), var(--bg-surface)); margin-bottom:16px;">
          <div class="card-meta-row" style="margin-bottom:8px;">
            <h3 style="color:var(--gold-400); font-size:1.02rem; display:flex; align-items:center; gap:6px;">${this.icon('trophy', 18)} <span>لوحة الشرف — أوائل ${this.esc(GRADES_META[u.grade] || '')}</span></h3>
            <span class="badge badge-gold">أعلى متوسط درجات</span>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${data.honor_roll.map((top, idx) => `
              <div style="flex:1; min-width:170px; background:var(--bg-card); border:1px solid var(--border-gold); border-radius:10px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <div>
                  <div style="font-weight:800; color:var(--gold-300); font-size:0.84rem; display:flex; align-items:center; gap:5px;">
                    ${this.icon(idx < 3 ? 'crown' : 'award', 14)} <span>#${idx + 1} ${this.esc(top.full_name)}</span>
                  </div>
                  <div style="font-size:0.72rem; color:var(--text-secondary);">${Number(top.exams_count)} امتحان</div>
                </div>
                <span class="badge badge-success">${Number(top.avg_percentage)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      return `
        <div class="fade-in">
          ${this.renderGamificationAndCountdownStrip()}
          ${retakeBannerHtml}
          ${honorRollHtml}

          <div class="student-courses-grid">
            ${visibleSubjects.map((key) => {
              const meta = SUBJECTS_META[key];
              const subjLessons = data.lessons.filter((l) => l.subject === key);
              const completedCount = subjLessons.filter((l) => Number(l.progress?.max_watched_percent || 0) >= 80).length;
              const pct = subjLessons.length > 0 ? Math.round((completedCount / subjLessons.length) * 100) : 0;
              const isSelected = this.selectedSubject === key;
              return `
                <button type="button" class="student-course-card ${isSelected ? 'active' : ''}" data-click="selectSubject" data-arg="${key}">
                  <div class="student-course-top">
                    <span class="student-course-icon">${this.icon(meta.iconName || 'book', 18)}</span>
                    <span class="student-course-count">${subjLessons.length} درس</span>
                  </div>
                  <div class="student-course-name">${this.esc(this.getSubjectName(key, u.grade))}</div>
                  <div class="progress-track" style="height:5px; margin-top:8px;"><div class="progress-fill" style="width:${pct}%;"></div></div>
                </button>
              `;
            }).join('')}
          </div>

          <div class="section-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">
                  ${this.icon(SUBJECTS_META[this.selectedSubject]?.iconName || 'book', 20)}
                  <span>محاضرات ${this.esc(activeSubjectName)} (${filteredLessons.length})</span>
                </h3>
                <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
                  اضغط على المحاضرة لفتح غرفة المذاكرة (الفيديو المحمي • المذكرة • الواجب • الامتحان)
                </p>
              </div>
              ${(this.lessonQuery || this.lessonUnitFilter !== 'all' || this.lessonStatusFilter !== 'all') ? `
                <button type="button" class="btn btn-outline-gold btn-sm" data-click="resetLessonFilters">${this.icon('refresh', 14)} <span>إعادة ضبط البحث</span></button>
              ` : ''}
            </div>

            <div class="lesson-filters-bar">
              <div style="position:relative;">
                <input
                  type="text"
                  id="studentLessonSearchInput"
                  class="form-control"
                  value="${this.esc(this.lessonQuery)}"
                  placeholder="ابحث باسم الدرس أو الوحدة..."
                  data-input="onLessonSearchInput"
                />
              </div>
              <select class="form-control" data-change="onLessonUnitFilterChange">
                <option value="all" ${this.lessonUnitFilter === 'all' ? 'selected' : ''}>كل الوحدات والأبواب</option>
                ${uniqueUnits.map((unit) => `<option value="${this.esc(unit)}" ${this.lessonUnitFilter === unit ? 'selected' : ''}>${this.esc(unit)}</option>`).join('')}
              </select>
              <select class="form-control" data-change="onLessonStatusFilterChange">
                <option value="all" ${this.lessonStatusFilter === 'all' ? 'selected' : ''}>كل الحالات</option>
                <option value="unlocked" ${this.lessonStatusFilter === 'unlocked' ? 'selected' : ''}>الحصص المفتوحة فقط</option>
                <option value="completed" ${this.lessonStatusFilter === 'completed' ? 'selected' : ''}>مكتملة المشاهدة (80%+)</option>
                <option value="incomplete" ${this.lessonStatusFilter === 'incomplete' ? 'selected' : ''}>لم تكتمل بعد</option>
              </select>
            </div>

            ${filteredLessons.length === 0 ? `
              <div style="text-align:center; padding:40px 20px; color:var(--text-secondary);">
                <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('search', 34)}</div>
                <div>${subjectLessonsAll.length === 0 ? `لا توجد محاضرات منشورة في مادة ${this.esc(activeSubjectName)} حالياً.` : 'لا توجد دروس مطابقة لخيارات البحث الحالية.'}</div>
              </div>
            ` : `
              <div class="grid-2">
                ${filteredLessons.map((lesson) => this.renderStudentLessonCard(lesson)).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    },

    renderStudentLessonCard(lesson) {
      const hw = lesson.assessments.find((a) => a.assessment_type === 'homework');
      const exam = lesson.assessments.find((a) => a.assessment_type === 'exam');

      if (!lesson.unlocked) {
        return `
          <div class="lesson-card locked">
            <div>
              <div class="card-meta-row">
                <span class="badge badge-danger">${this.icon('lock', 13)} <span>الحصة ${Number(lesson.order_index)} (مغلقة)</span></span>
                <span class="badge badge-gold">${this.esc(lesson.unit_title)}</span>
              </div>
              <h4 style="color:var(--danger-text); font-size:1.05rem; margin-bottom:6px;">${this.esc(lesson.title)}</h4>
              <div style="background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.35); padding:10px 12px; border-radius:10px; font-size:0.82rem; color:var(--danger-text); font-weight:700; margin-top:10px;">
                ${this.esc(lesson.lock_reason)}
              </div>
            </div>
            ${lesson.lock_type === 'subscription' ? `
              <button class="btn btn-gold btn-sm" style="width:100%;" data-click="openRedeemVoucherModal">${this.icon('ticket', 14)} <span>شحن كود الاشتراك الشهري لفتح المحاضرة</span></button>
            ` : ''}
          </div>
        `;
      }

      const watchPct = Number(lesson.progress?.max_watched_percent || 0);
      const hasResume = Number(lesson.progress?.last_position_seconds || 0) > 10;

      return `
        <div class="lesson-card">
          <div>
            <div class="card-meta-row">
              <span class="badge badge-success">${this.icon('unlock', 13)} <span>الحصة ${Number(lesson.order_index)}</span></span>
              <span class="badge badge-gold">${this.icon('clock', 12)} <span>${Number(lesson.duration_minutes)} د • ${this.esc(lesson.unit_title)}</span></span>
            </div>
            <h4 style="color:var(--gold-400); font-size:1.08rem; margin-bottom:6px;">${this.esc(lesson.title)}</h4>
            <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:10px;">${this.esc(lesson.description || 'شرح تفصيلي ومذكرة محمية وتدريبات شاملة.')}</p>
            ${watchPct > 0 ? `
              <div style="margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:var(--gold-300); margin-bottom:4px;">
                  <span>نسبة مشاهدة المحاضرة</span>
                  <b>${watchPct}%</b>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${Math.min(100, watchPct)}%;"></div>
                </div>
              </div>
            ` : ''}
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <div class="form-row-2">
              <button class="btn btn-gold btn-sm" style="padding:10px;" data-click="openLessonWorkspace" data-id="${Number(lesson.id)}" data-arg="video">
                ${this.icon('play', 15)} <span>${hasResume ? 'استكمال المشاهدة' : 'تشغيل المحاضرة'}</span>
              </button>
              <button class="btn btn-outline-gold btn-sm" style="padding:10px;" data-click="openLessonWorkspace" data-id="${Number(lesson.id)}" data-arg="pdf">
                ${this.icon('book-open', 15)} <span>قراءة المذكرة (PDF)</span>
              </button>
            </div>

            ${(hw || exam) ? `
              <div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:10px; border-top:1px solid var(--border-subtle);">
                ${hw ? `
                  <button class="btn btn-emerald btn-sm" style="flex:1;" data-click="startAssessment" data-id="${Number(hw.id)}">
                    ${this.icon('file-text', 14)} <span>${hw.latest_submission ? `الواجب (${Number(hw.latest_submission.percentage)}%)` : 'حل الواجب'}</span>
                  </button>
                ` : ''}
                ${exam ? `
                  <button class="btn btn-outline-gold btn-sm" style="flex:1;" data-click="startAssessment" data-id="${Number(exam.id)}">
                    ${this.icon('award', 14)} <span>${exam.latest_submission ? `الامتحان (${Number(exam.latest_submission.percentage)}%)` : 'امتحان الحصة'}</span>
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    },

    renderUnifiedLessonWorkspace(lessonId) {
      const allLessons = this.studentDashboardData?.lessons || this.adminData?.lessons || [];
      const lesson = allLessons.find((l) => l.id === lessonId);
      if (!lesson) {
        this.activeLessonId = null;
        return `<div class="section-card">المحاضرة غير موجودة.</div>`;
      }

      const studentWatermarkText = `${this.esc(this.user.full_name)} • ${this.esc(this.user.phone)}`;
      const safeBunnySrc = this.safeHttpsUrl(this.currentBunnyEmbedUrl);
      const isBunnyVideo = Boolean(safeBunnySrc && lesson.video_type === 'bunny');
      const isRealUploadedVideo = Boolean(!isBunnyVideo && (lesson.has_uploaded_video || (lesson.video_path && lesson.video_path.startsWith('uploads/videos/'))));
      const streamUrl = `/api/stream/video/${Number(lesson.id)}`;
      const hw = (lesson.assessments || []).find((a) => a.assessment_type === 'homework');
      const exam = (lesson.assessments || []).find((a) => a.assessment_type === 'exam');

      return `
        <div class="fade-in">
          <div class="section-card" style="padding:14px 20px; margin-bottom:16px;">
            <div class="card-meta-row" style="margin-bottom:0;">
              <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <button class="btn btn-outline-gold btn-sm" data-click="navigateHome">${this.icon('arrow-right', 15)} <span>العودة للمحاضرات</span></button>
                <div>
                  <span class="badge badge-gold">${this.esc(this.getSubjectName(lesson.subject, lesson.grade))} • الحصة ${Number(lesson.order_index)}</span>
                  <h3 style="color:var(--gold-400); font-size:1.12rem; margin-top:2px;">${this.esc(lesson.title)}</h3>
                </div>
              </div>

              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn btn-sm ${this.activeLessonSubTab === 'video' ? 'btn-gold' : 'btn-outline-gold'}" data-click="switchLessonSubTab" data-arg="video">${this.icon('video', 15)} <span>شرح الفيديو المحمي</span></button>
                <button class="btn btn-sm ${this.activeLessonSubTab === 'pdf' ? 'btn-gold' : 'btn-outline-gold'}" data-click="switchLessonSubTab" data-arg="pdf">${this.icon('book-open', 15)} <span>مذكرة الدرس (PDF)</span></button>
                ${hw ? `<button class="btn btn-sm btn-emerald" data-click="startAssessment" data-id="${Number(hw.id)}">${this.icon('file-text', 15)} <span>واجب الحصة</span></button>` : ''}
                ${exam ? `<button class="btn btn-sm btn-outline-gold" data-click="startAssessment" data-id="${Number(exam.id)}">${this.icon('award', 15)} <span>امتحان الحصة</span></button>` : ''}
              </div>
            </div>
          </div>

          ${this.activeLessonSubTab === 'video' ? `
            <div class="section-card" style="padding:16px;">
              <div class="protected-player-wrapper" id="protectedPlayerContainer">
                <div class="video-stage">
                  <div class="dynamic-watermark" id="dynamicVideoWatermark">${this.icon('shield', 13)} ${studentWatermarkText}</div>

                  <div class="anti-capture-curtain" id="videoSecurityCurtain">
                    <div style="color:var(--gold-400); margin-bottom:8px;">${this.icon('shield', 40)}</div>
                    <h3 style="margin:8px 0; font-size:1.1rem;">تم إيقاف العرض مؤقتاً</h3>
                    <p style="color:var(--text-secondary); max-width:400px; margin-bottom:12px; font-size:0.84rem;">يرجى البقاء داخل نافذة الدرس لمتابعة المشاهدة.</p>
                    <button class="btn btn-gold btn-sm" data-click="resumeFromCurtain">${this.icon('play', 14)} <span>استئناف المشاهدة</span></button>
                  </div>

                  ${isBunnyVideo ? `
                    <iframe
                      src="${this.esc(safeBunnySrc)}"
                      loading="lazy"
                      style="width:100%; height:100%; border:0; min-height:420px;"
                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                      allowfullscreen
                    ></iframe>
                  ` : (isRealUploadedVideo ? `
                    <video
                      id="protectedHtmlVideo"
                      class="protected-video-element"
                      src="${streamUrl}"
                      preload="auto"
                      data-click="toggleProtectedPlay"
                      controlslist="nodownload nofullscreen noremoteplayback"
                      disablepictureinpicture
                      playsinline
                      style="cursor:pointer;"
                    ></video>
                    <div id="videoBufferBadge" style="display:none; position:absolute; bottom:14px; left:14px; z-index:36; background:rgba(5,17,12,0.82); border:1px solid var(--gold-400); color:var(--gold-300); padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:700;">جاري التحميل...</div>
                  ` : `
                    <canvas id="synthLectureCanvas" class="protected-canvas-stream" data-click="toggleProtectedPlay" width="1280" height="720" style="cursor:pointer;"></canvas>
                  `)}
                </div>

                ${!isBunnyVideo ? `
                  <div class="custom-video-controls">
                    <button type="button" id="protectedPlayBtn" class="btn btn-gold btn-sm" data-click="toggleProtectedPlay">${this.icon('play', 14)} <span>تشغيل</span></button>
                    <button type="button" class="btn btn-outline-gold btn-sm" data-click="seekVideoRelative" data-arg="-10" title="رجوع 10 ثواني">${this.icon('rotate-ccw', 14)} <span>10ث</span></button>
                    <button type="button" class="btn btn-outline-gold btn-sm" data-click="seekVideoRelative" data-arg="10" title="تقديم 10 ثواني">${this.icon('rotate-cw', 14)} <span>10ث</span></button>
                    <input type="range" dir="ltr" id="videoSeekSlider" class="progress-slider" min="0" max="100" value="0" data-input="seekProtectedVideo" />
                    <span id="videoTimeDisplay" style="font-size:0.78rem; font-weight:700; color:var(--gold-300); min-width:85px; text-align:center;">00:00 / ${Number(lesson.duration_minutes)}:00</span>
                    <select class="form-control" style="width:auto; padding:4px 10px; font-size:0.78rem;" data-change="changeVideoSpeed">
                      <option value="0.75">0.75x</option>
                      <option value="1" selected>السرعة: 1x</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2x</option>
                    </select>
                    <button type="button" class="btn btn-outline-gold btn-sm" data-click="toggleProtectedFullscreen">${this.icon('maximize', 14)} <span>ملء الشاشة</span></button>
                  </div>
                  <div style="padding:6px 14px; font-size:0.72rem; color:var(--text-muted); border-top:1px solid var(--border-subtle); background:var(--bg-surface);">
                    اختصارات لوحة المفاتيح: مسافة / K للتشغيل والإيقاف • الأسهم أو J / L لتقديم وترجيع ١٠ ثوانٍ • F لملء الشاشة
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="section-card lesson-notes-panel">
              <div class="section-header">
                <div>
                  <h4 class="section-title" style="font-size:1rem;">${this.icon('bookmark', 17)} <span>ملاحظاتي على الحصة (مرتبطة بتوقيت الفيديو)</span></h4>
                  <p style="font-size:0.78rem; color:var(--text-secondary);">دوّن فوائـدك أثناء المشاهدة، واضغط على التوقيت للعودة لتلك اللحظة مباشرة</p>
                </div>
                <span class="badge badge-gold" id="currentVideoNoteTimeBadge">${this.icon('clock', 12)} <span>00:00</span></span>
              </div>
              <form data-submit="handleAddLessonNote" data-id="${Number(lesson.id)}" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
                <input type="text" id="lessonNoteInput" class="form-control" style="flex:1; min-width:220px;" minlength="2" maxlength="500" placeholder="اكتب ملاحظتك عند التوقيت الحالي للشرح..." required />
                <button type="submit" class="btn btn-gold btn-sm">${this.icon('plus', 15)} <span>حفظ الملاحظة</span></button>
              </form>
              <div id="lessonNotesHost" style="display:flex; flex-direction:column; gap:8px;">
                <div class="skeleton-line"></div>
              </div>
            </div>
          ` : `
            <div class="section-card">
              <div class="card-meta-row">
                <div>
                  <span class="badge badge-gold">${this.icon('lock', 12)} <span>عارض المذكرات — بعلامة مائية خاصة بالطالب</span></span>
                  <h4 style="color:var(--gold-400); margin-top:4px;">${this.esc(lesson.pdf_title || `مذكرة ${lesson.title}`)}</h4>
                </div>
                <button class="btn btn-outline-gold btn-sm" data-click="switchLessonSubTab" data-arg="video">${this.icon('video', 15)} <span>العودة للفيديو</span></button>
              </div>
              <div class="protected-pdf-viewer" id="protectedPdfViewerContainer">
                <div id="realPdfCanvasPagesHost" style="display:flex; flex-direction:column; gap:18px; align-items:center;">
                  <div style="width:100%; max-width:720px; display:flex; flex-direction:column; gap:12px;">
                    <div class="skeleton-card"><div class="skeleton-line lg"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
                  </div>
                </div>
              </div>
            </div>
          `}

          <div class="section-card" style="margin-top:16px;">
            <div class="section-header">
              <div>
                <h4 class="section-title" style="font-size:1rem;">${this.icon('help-circle', 17)} <span>اسأل فضيلة الأستاذ حول هذه الحصة</span></h4>
                <p style="font-size:0.78rem; color:var(--text-secondary);">أرسل أي مسألة أو استفسار شرعي في الدرس، وتظهر الإجابات المنشورة هنا ليستفيد منها الجميع</p>
              </div>
            </div>
            ${this.user?.role !== 'admin' ? `
              <form data-submit="handleAskLessonQuestion" data-id="${Number(lesson.id)}" style="margin-bottom:14px;">
                <div class="form-group" style="margin-bottom:8px;">
                  <textarea id="lessonQuestionInput" class="form-control" rows="2" minlength="5" maxlength="600" placeholder="اكتب سؤالك الشرعي أو استفسارك عن هذه الحصة..." required></textarea>
                </div>
                <button type="submit" class="btn btn-outline-gold btn-sm">${this.icon('message-circle', 15)} <span>إرسال السؤال للأستاذ</span></button>
              </form>
            ` : ''}
            <div id="lessonQuestionsHost" style="display:flex; flex-direction:column; gap:8px;">
              <div class="skeleton-line"></div>
            </div>
          </div>
        </div>
      `;
    },

    formatSecondsMMSS(sec) {
      const total = Math.max(0, Math.floor(Number(sec || 0)));
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      return `${m}:${s}`;
    },

    getCurrentVideoSecond() {
      const vid = document.getElementById('protectedHtmlVideo');
      if (vid && !Number.isNaN(vid.currentTime)) return Math.floor(vid.currentTime);
      return 0;
    },

    async loadLessonNotes(lessonId) {
      const host = document.getElementById('lessonNotesHost');
      if (!host) return;
      try {
        const res = await this.api(`/api/lessons/${Number(lessonId)}/notes`);
        this.activeLessonNotes = Array.isArray(res.notes) ? res.notes : [];
        this.renderLessonNotesList();
      } catch {
        if (host) host.innerHTML = '';
      }
    },

    renderLessonNotesList() {
      const host = document.getElementById('lessonNotesHost');
      if (!host) return;
      const list = this.activeLessonNotes || [];
      if (list.length === 0) {
        host.innerHTML = `<div style="font-size:0.82rem; color:var(--text-secondary);">لم تسجل أي ملاحظات على هذه الحصة بعد.</div>`;
        return;
      }
      host.innerHTML = list.map((n) => `
        <div class="note-item">
          <div style="display:flex; align-items:flex-start; gap:10px; min-width:0; flex:1;">
            <button type="button" class="note-ts-btn" data-click="jumpToVideoSecond" data-arg="${Number(n.timestamp_seconds || 0)}" title="الانتقال لهذه الثانية">
              ${this.icon('play', 12)}
              <span>${this.formatSecondsMMSS(n.timestamp_seconds)}</span>
            </button>
            <div style="font-size:0.85rem; color:var(--text-primary); line-height:1.55;">${this.esc(n.note_text)}</div>
          </div>
          <button type="button" class="btn btn-danger btn-sm" style="padding:4px 8px;" data-click="deleteLessonNote" data-id="${Number(n.id)}" title="حذف الملاحظة">
            ${this.icon('trash', 13)}
          </button>
        </div>
      `).join('');
    },

    async handleAddLessonNote(e, lessonId) {
      e.preventDefault();
      const input = document.getElementById('lessonNoteInput');
      const note_text = (input?.value || '').trim();
      if (!note_text) return;
      const timestamp_seconds = this.getCurrentVideoSecond();
      try {
        const res = await this.api(`/api/lessons/${Number(lessonId)}/notes`, {
          method: 'POST',
          body: JSON.stringify({ note_text, timestamp_seconds })
        });
        if (input) input.value = '';
        if (res.note) {
          this.activeLessonNotes.push(res.note);
          this.activeLessonNotes.sort((a, b) => Number(a.timestamp_seconds) - Number(b.timestamp_seconds));
          this.renderLessonNotesList();
        }
        this.showToast(res.message, 'success');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteLessonNote(noteId) {
      if (!this.activeLessonId || !noteId) return;
      try {
        await this.api(`/api/lessons/${Number(this.activeLessonId)}/notes/${Number(noteId)}`, { method: 'DELETE' });
        this.activeLessonNotes = (this.activeLessonNotes || []).filter((n) => n.id !== noteId);
        this.renderLessonNotesList();
        this.showToast('تم حذف الملاحظة.', 'success');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    jumpToVideoSecond(sec) {
      const vid = document.getElementById('protectedHtmlVideo');
      if (!vid) return;
      const target = Math.max(0, Number(sec || 0));
      try {
        vid.currentTime = Number.isFinite(vid.duration) ? Math.min(target, vid.duration) : target;
        vid.play().catch(() => {});
        document.getElementById('protectedPlayerContainer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
    },

    seekVideoRelative(deltaSec) {
      const vid = document.getElementById('protectedHtmlVideo');
      if (vid) {
        const next = Math.max(0, vid.currentTime + Number(deltaSec || 0));
        vid.currentTime = Number.isFinite(vid.duration) ? Math.min(next, vid.duration) : next;
      } else {
        this.synthProgress = Math.min(100, Math.max(0, Number(this.synthProgress || 0) + (deltaSec > 0 ? 4 : -4)));
      }
    },

    async loadLessonQuestions(lessonId) {
      const host = document.getElementById('lessonQuestionsHost');
      if (!host) return;
      try {
        const res = await this.api(`/api/lessons/${Number(lessonId)}/questions`);
        const list = Array.isArray(res.questions) ? res.questions : [];
        if (!document.getElementById('lessonQuestionsHost')) return;
        if (list.length === 0) {
          host.innerHTML = `<div style="font-size:0.82rem; color:var(--text-secondary);">لا توجد أسئلة منشورة لهذه الحصة بعد. كن أول من يسأل!</div>`;
          return;
        }
        host.innerHTML = list.map((q) => `
          <div style="background:var(--bg-card); border:1px solid ${q.admin_answer ? 'rgba(16,185,129,0.35)' : 'var(--border-gold)'}; border-radius:10px; padding:10px 12px;">
            <div class="card-meta-row" style="margin-bottom:4px;">
              <span style="font-weight:800; color:var(--gold-300); font-size:0.8rem;">${this.esc(q.student_name)}</span>
              <span class="badge ${q.admin_answer ? 'badge-success' : 'badge-gold'}">${q.admin_answer ? 'تمت الإجابة' : 'بانتظار رد الأستاذ'}</span>
            </div>
            <div style="font-size:0.86rem; color:var(--text-primary); margin-bottom:${q.admin_answer ? '8px' : '0'};">${this.esc(q.question_text)}</div>
            ${q.admin_answer ? `
              <div style="background:rgba(16,185,129,0.1); border-right:3px solid #10b981; padding:8px 10px; border-radius:6px; font-size:0.84rem; color:var(--success-text);">
                <b>رد فضيلة الأستاذ:</b> ${this.esc(q.admin_answer)}
              </div>
            ` : ''}
          </div>
        `).join('');
      } catch {
        if (host) host.innerHTML = '';
      }
    },

    async handleAskLessonQuestion(e, lessonId) {
      e.preventDefault();
      const input = document.getElementById('lessonQuestionInput');
      const question_text = (input?.value || '').trim();
      if (!question_text) return;
      try {
        const res = await this.api(`/api/lessons/${Number(lessonId)}/questions`, {
          method: 'POST',
          body: JSON.stringify({ question_text })
        });
        if (input) input.value = '';
        this.showToast(res.message, 'success');
        await this.loadLessonQuestions(lessonId);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async saveVideoProgress(lessonId, posSec, durSec) {
      if (!this.user || this.user.role === 'admin') return;
      try {
        const res = await this.api(`/api/lessons/${Number(lessonId)}/progress`, {
          method: 'POST',
          body: JSON.stringify({ position_seconds: Math.floor(posSec || 0), duration_seconds: Math.floor(durSec || 0) })
        });
        if (res && res.progress && this.studentDashboardData?.lessons) {
          const targetLesson = this.studentDashboardData.lessons.find((l) => l.id === Number(lessonId));
          if (targetLesson) targetLesson.progress = res.progress;
        }
      } catch {}
    },

    async initLessonMediaAfterRender(lessonId, subTab) {
      this.loadLessonQuestions(lessonId);
      if (subTab === 'video') this.loadLessonNotes(lessonId);
      const allLessons = this.studentDashboardData?.lessons || this.adminData?.lessons || [];
      const lesson = allLessons.find((l) => l.id === lessonId);
      if (!lesson) return;

      if (subTab === 'video') {
        this.watermarkInterval = null;

        if (this.currentBunnyEmbedUrl && lesson.video_type === 'bunny') return;

        const isRealUploadedVideo = Boolean(lesson.has_uploaded_video || (lesson.video_path && lesson.video_path.startsWith('uploads/videos/')));
        if (isRealUploadedVideo) {
          const vid = document.getElementById('protectedHtmlVideo');
          const slider = document.getElementById('videoSeekSlider');
          const timeDisp = document.getElementById('videoTimeDisplay');
          const playBtn = document.getElementById('protectedPlayBtn');
          const bufBadge = document.getElementById('videoBufferBadge');
          const noteTimeBadge = document.getElementById('currentVideoNoteTimeBadge');
          if (vid) {
            let resumedOnce = false;
            let recoveryAttempts = 0;
            this._lastSavedProgressSec = 0;

            const showBuffering = () => {
              if (!bufBadge) return;
              let pctText = '';
              try {
                if (vid.duration && vid.buffered && vid.buffered.length > 0) {
                  const bufEnd = vid.buffered.end(vid.buffered.length - 1);
                  const pct = Math.min(100, Math.round((bufEnd / vid.duration) * 100));
                  if (Number.isFinite(pct) && pct > 0) pctText = ` (${pct}%)`;
                }
              } catch {}
              bufBadge.textContent = `جاري التحميل...${pctText}`;
              bufBadge.style.display = 'block';
            };
            const hideBuffering = () => {
              if (bufBadge) bufBadge.style.display = 'none';
            };

            vid.addEventListener('loadedmetadata', () => {
              const resumeAt = Number(lesson.progress?.last_position_seconds || 0);
              if (!resumedOnce && resumeAt > 5 && vid.duration && resumeAt < vid.duration - 5) {
                resumedOnce = true;
                try {
                  vid.currentTime = resumeAt;
                  this.showToast(`تم استكمال المشاهدة من الدقيقة ${this.formatSecondsMMSS(resumeAt)}.`, 'gold');
                } catch {}
              }
            });
            vid.addEventListener('waiting', () => {
              if (vid.readyState < 3 && !vid.paused) showBuffering();
            });
            vid.addEventListener('stalled', () => {
              if (vid.readyState < 3 && !vid.paused) showBuffering();
            });
            vid.addEventListener('progress', () => {
              if (bufBadge && bufBadge.style.display === 'block') {
                if (vid.readyState >= 3) hideBuffering();
                else showBuffering();
              }
            });
            vid.addEventListener('canplay', hideBuffering);
            vid.addEventListener('canplaythrough', hideBuffering);
            vid.addEventListener('seeked', () => {
              if (vid.readyState >= 3) hideBuffering();
            });
            vid.addEventListener('playing', () => {
              hideBuffering();
              if (playBtn) playBtn.innerHTML = `${this.icon('pause', 14)} <span>إيقاف مؤقت</span>`;
            });
            vid.addEventListener('play', () => {
              if (vid.readyState >= 3) hideBuffering();
              if (playBtn) playBtn.innerHTML = `${this.icon('pause', 14)} <span>إيقاف مؤقت</span>`;
            });
            vid.addEventListener('pause', () => {
              hideBuffering();
              if (playBtn) playBtn.innerHTML = `${this.icon('play', 14)} <span>تشغيل</span>`;
              if (vid.duration) this.saveVideoProgress(lessonId, vid.currentTime, vid.duration);
            });
            vid.addEventListener('ended', () => {
              hideBuffering();
              if (playBtn) playBtn.innerHTML = `${this.icon('rotate-ccw', 14)} <span>إعادة التشغيل</span>`;
              if (vid.duration) this.saveVideoProgress(lessonId, vid.duration, vid.duration);
            });
            vid.addEventListener('error', async () => {
              hideBuffering();
              if (recoveryAttempts < 2 && document.getElementById('protectedHtmlVideo') === vid) {
                recoveryAttempts++;
                const resumeSec = Math.floor(vid.currentTime || 0);
                try {
                  await this.api(`/api/media/ticket/${Number(lessonId)}`, { method: 'POST' });
                  const currentSpeed = vid.playbackRate || 1;
                  vid.src = `/api/stream/video/${Number(lessonId)}?r=${Date.now()}`;
                  vid.addEventListener('loadedmetadata', () => {
                    try {
                      if (resumeSec > 0 && vid.duration) vid.currentTime = Math.min(resumeSec, vid.duration);
                      vid.playbackRate = currentSpeed;
                      vid.play().catch(() => {});
                    } catch {}
                  }, { once: true });
                  return;
                } catch {}
              }
              this.showToast('تعذر تحميل ملف الفيديو. يرجى تحديث الصفحة أو التأكد من استقرار الإنترنت.', 'danger');
            });
            vid.addEventListener('timeupdate', () => {
              if (vid.readyState >= 3) hideBuffering();
              if (vid.duration) {
                if (slider && !slider.matches(':active')) slider.value = (vid.currentTime / vid.duration) * 100;
                const formattedCur = this.formatSecondsMMSS(vid.currentTime);
                const formattedTot = this.formatSecondsMMSS(vid.duration);
                if (timeDisp) timeDisp.textContent = `${formattedCur} / ${formattedTot}`;
                if (noteTimeBadge) {
                  const sp = noteTimeBadge.querySelector('span');
                  if (sp) sp.textContent = formattedCur;
                }
                const curSecFloor = Math.floor(vid.currentTime);
                if (Math.abs(curSecFloor - this._lastSavedProgressSec) >= 12) {
                  this._lastSavedProgressSec = curSecFloor;
                  this.saveVideoProgress(lessonId, curSecFloor, vid.duration);
                }
              }
            });
          }
        } else {
          this.startInteractiveShariaBoard(lesson);
        }
      } else if (subTab === 'pdf') {
        try {
          const res = await this.api(`/api/stream/pdf/${Number(lessonId)}`);
          if (res.has_binary_pdf) {
            await this.renderProtectedPdfStreamToCanvases(lessonId, res.stream_ticket, res.watermark_text);
          } else {
            const host = document.getElementById('realPdfCanvasPagesHost');
            if (host) {
              const pages = res.structured_pages || [];
              host.innerHTML = pages.map((p) => `
                <div class="pdf-page-canvas-wrap">
                  <div class="pdf-page-watermark-overlay">
                    <span>${this.esc(res.watermark_text)}</span>
                    <span>${this.esc(res.watermark_text)}</span>
                  </div>
                  <h4 style="color:#0a3c2a; margin-bottom:12px; text-align:center;">${this.esc(p.heading || res.pdf_title)}</h4>
                  <div class="amiri-font" style="background:#f3ead6; border:2px solid #b89246; border-radius:10px; padding:14px; font-size:1.15rem; font-weight:700; color:#07291d; text-align:center; margin-bottom:14px;">
                    ${this.esc(p.matn || '')}
                  </div>
                  ${(p.sharh || []).map((line) => `<p style="margin-bottom:8px; color:#1c3127; font-weight:600;">• ${this.esc(line)}</p>`).join('')}
                </div>
              `).join('');
            }
          }
        } catch (err) {
          this.showToast(err.message, 'danger');
        }
      }
    },

    async renderProtectedPdfStreamToCanvases(lessonId, streamTicket, watermarkText) {
      const host = document.getElementById('realPdfCanvasPagesHost');
      if (!host) return;
      try {
        const pdfRes = await fetch(`/api/stream/pdf-file/${Number(lessonId)}`, {
          credentials: 'same-origin',
          headers: {
            ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
            'X-Device-Id': this.deviceId,
            'X-Stream-Ticket': streamTicket || ''
          }
        });
        if (!pdfRes.ok) throw new Error('تعذر جلب ملف المذكرة المحمي');
        const arrayBuffer = await pdfRes.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        if (!window.pdfjsLib) {
          throw new Error('تعذر تحميل محرك عرض PDF على هذا المتصفح. يمكنك متابعة القراءة عبر المذكرة النصية أدناه.');
        }

        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
        const pdfDoc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        host.innerHTML = '';

        const isMobileViewport = window.innerWidth <= 768;
        const pdfScale = isMobileViewport ? 1.15 : 1.45;
        const renderPage = async (pageNum, pageWrap) => {
          if (pageWrap.dataset.rendered === '1' || pageWrap.dataset.rendering === '1') return;
          pageWrap.dataset.rendering = '1';
          try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: pdfScale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.cssText = 'width:100%; height:auto; display:block; pointer-events:none;';

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            ctx.save();
            ctx.font = 'bold 24px "Thmanyah Sans", sans-serif';
            ctx.fillStyle = 'rgba(10, 60, 42, 0.14)';
            ctx.textAlign = 'center';
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-Math.PI / 7);
            ctx.fillText(watermarkText, 0, -180);
            ctx.fillText(watermarkText, 0, 0);
            ctx.fillText(watermarkText, 0, 180);
            ctx.restore();

            pageWrap.innerHTML = '';
            pageWrap.style.minHeight = '0';
            pageWrap.appendChild(canvas);
            pageWrap.dataset.rendered = '1';
          } catch {
            pageWrap.innerHTML = `<div style="padding:18px; text-align:center; color:var(--danger-text);">تعذر عرض الصفحة ${pageNum}</div>`;
          } finally {
            pageWrap.dataset.rendering = '0';
          }
        };

        const observer = typeof IntersectionObserver === 'function'
          ? new IntersectionObserver((entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  const wrap = entry.target;
                  const pNum = Number(wrap.dataset.pageNum);
                  observer.unobserve(wrap);
                  renderPage(pNum, wrap);
                }
              }
            }, { rootMargin: '500px 0px' })
          : null;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const pageWrap = document.createElement('div');
          pageWrap.dataset.pageNum = String(pageNum);
          pageWrap.style.cssText = 'position:relative; width:100%; max-width:800px; min-height:280px; background:#fff; border:1.5px solid var(--gold-500); border-radius:10px; overflow:hidden; box-shadow:0 8px 25px rgba(0,0,0,0.45);';
          pageWrap.innerHTML = `<div style="padding:32px; text-align:center; color:#0a3c2a; font-weight:700;">جاري تجهيز صفحة ${pageNum} من ${pdfDoc.numPages}...</div>`;
          host.appendChild(pageWrap);
          if (pageNum <= 3 || !observer) {
            await renderPage(pageNum, pageWrap);
          } else {
            observer.observe(pageWrap);
          }
        }
      } catch (e) {
        host.innerHTML = `<div style="color:var(--danger-text); padding:12px;">${this.esc(e.message)}</div>`;
      }
    },

    startInteractiveShariaBoard(lesson) {
      const canvas = document.getElementById('synthLectureCanvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      this.synthPlaying = true;
      this.synthProgress = 0;
      const playBtn = document.getElementById('protectedPlayBtn');
      if (playBtn) playBtn.innerHTML = `${this.icon('pause', 14)} <span>إيقاف مؤقت</span>`;

      const pages = lesson.pdf_content && lesson.pdf_content.length > 0 ? lesson.pdf_content : [
        {
          heading: lesson.title,
          matn: '«بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ — الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ»',
          sharh: [lesson.description || 'شرح تفصيلي للمتن المقرر على طلاب الأزهر الشريف.']
        }
      ];

      const drawFrame = () => {
        if (!document.getElementById('synthLectureCanvas')) {
          clearInterval(this.synthCanvasInterval);
          return;
        }
        if (this.synthPlaying) {
          this.synthProgress = (this.synthProgress + 0.15) % 100;
          const slider = document.getElementById('videoSeekSlider');
          const timeDisp = document.getElementById('videoTimeDisplay');
          if (slider) slider.value = this.synthProgress;
          if (timeDisp) {
            const curSec = Math.floor((this.synthProgress / 100) * lesson.duration_minutes * 60);
            timeDisp.textContent = `${this.formatSecondsMMSS(curSec)} / ${lesson.duration_minutes}:00`;
          }
        }

        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, '#051f16');
        grad.addColorStop(0.5, '#0a3c2a');
        grad.addColorStop(1, '#041810');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);

        ctx.strokeStyle = '#d4b26a';
        ctx.lineWidth = 4;
        ctx.strokeRect(24, 24, 1232, 672);

        ctx.fillStyle = 'rgba(212, 178, 106, 0.15)';
        ctx.fillRect(36, 36, 1208, 70);
        ctx.fillStyle = '#e5c883';
        ctx.font = '700 24px "Thmanyah Sans", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('منصة مَتْن (MATN) · فضيلة الأستاذ محمد عبد الله', 1210, 80);

        const pageIdx = Math.floor((this.synthProgress / 100) * pages.length) % pages.length;
        const activePage = pages[pageIdx];

        ctx.fillStyle = '#f3dfb1';
        ctx.font = '700 26px "Thmanyah Serif Display", "Thmanyah Sans", serif';
        ctx.textAlign = 'center';
        const currentY = this.wrapCanvasText(ctx, activePage.heading || lesson.title, 640, 148, 1100, 34);

        const matnTop = currentY + 18;
        ctx.font = '700 23px "Thmanyah Serif Text", "Thmanyah Sans", serif';
        const matnLines = this.computeWrappedLines(ctx, activePage.matn || '', 1040);
        const matnBoxHeight = Math.max(84, matnLines.length * 34 + 28);

        ctx.fillStyle = 'rgba(4, 26, 18, 0.88)';
        ctx.fillRect(90, matnTop, 1100, matnBoxHeight);
        ctx.strokeStyle = '#d4b26a';
        ctx.lineWidth = 2;
        ctx.strokeRect(90, matnTop, 1100, matnBoxHeight);

        ctx.fillStyle = '#e5c883';
        ctx.textAlign = 'center';
        let matnY = matnTop + 34;
        for (const l of matnLines) {
          ctx.fillText(l, 640, matnY);
          matnY += 34;
        }

        ctx.textAlign = 'right';
        ctx.font = '400 21px "Thmanyah Sans", sans-serif';
        let y = matnTop + matnBoxHeight + 36;
        for (const pt of (activePage.sharh || [])) {
          if (y > 560) break;
          ctx.fillStyle = '#6ee7b7';
          ctx.fillText('◆', 1175, y);
          ctx.fillStyle = '#f8f5ec';
          y = this.wrapCanvasText(ctx, pt, 1145, y, 1040, 32) + 12;
        }
      };

      drawFrame();
      this.synthCanvasInterval = setInterval(drawFrame, 250);
    },

    computeWrappedLines(ctx, text, maxWidth) {
      const words = String(text || '').split(/\s+/);
      const lines = [];
      let line = '';
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
          lines.push(line.trim());
          line = words[n] + ' ';
        } else {
          line = testLine;
        }
      }
      if (line.trim()) lines.push(line.trim());
      return lines;
    },

    wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
      const lines = this.computeWrappedLines(ctx, text, maxWidth);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y);
        if (i < lines.length - 1) y += lineHeight;
      }
      return y;
    },

    toggleProtectedPlay() {
      const vid = document.getElementById('protectedHtmlVideo');
      const playBtn = document.getElementById('protectedPlayBtn');
      if (vid) {
        if (vid.paused) vid.play().catch(() => {});
        else vid.pause();
      } else {
        this.synthPlaying = !this.synthPlaying;
        if (playBtn) playBtn.innerHTML = this.synthPlaying ? `${this.icon('pause', 14)} <span>إيقاف مؤقت</span>` : `${this.icon('play', 14)} <span>تشغيل</span>`;
      }
    },

    seekProtectedVideo(val) {
      const vid = document.getElementById('protectedHtmlVideo');
      if (vid && vid.duration) vid.currentTime = (Number(val) / 100) * vid.duration;
      else this.synthProgress = Number(val);
    },

    changeVideoSpeed(speed) {
      const vid = document.getElementById('protectedHtmlVideo');
      if (vid) vid.playbackRate = Number(speed);
    },

    toggleProtectedFullscreen() {
      const container = document.getElementById('protectedPlayerContainer');
      const vid = document.getElementById('protectedHtmlVideo');
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (container && container.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          if (vid && typeof vid.webkitEnterFullscreen === 'function') vid.webkitEnterFullscreen();
        });
      } else if (container && typeof container.webkitRequestFullscreen === 'function') {
        container.webkitRequestFullscreen();
      } else if (vid && typeof vid.webkitEnterFullscreen === 'function') {
        vid.webkitEnterFullscreen();
      }
    },

    getExamDraftStorageKey(sessionObj) {
      const uid = this.user?.id || 'guest';
      const sid = sessionObj?.session_id || sessionObj?.id || '0';
      return `matn_exam_draft_${uid}_${sid}`;
    },

    saveExamDraftToStorage() {
      const sess = this.activeAssessmentSession;
      if (!sess) return;
      try {
        localStorage.setItem(
          this.getExamDraftStorageKey(sess.assessment),
          JSON.stringify({ answers: sess.answers, flagged: sess.flagged || {} })
        );
      } catch {}
    },

    clearExamDraftStorage(assessmentMeta) {
      try {
        localStorage.removeItem(this.getExamDraftStorageKey(assessmentMeta));
      } catch {}
    },

    async startAssessment(assessmentId) {
      try {
        this.stopActiveMediaLoops();
        const root = document.getElementById('appRoot');
        if (root) root.innerHTML = this.renderSkeletonView('جاري تجهيز أسئلة الاختبار...');

        const data = await this.api(`/api/assessments/${Number(assessmentId)}/start`);
        this.closeModal();

        let restoredAnswers = {};
        let restoredFlags = {};
        try {
          const rawDraft = localStorage.getItem(this.getExamDraftStorageKey(data.assessment));
          if (rawDraft) {
            const parsed = JSON.parse(rawDraft);
            if (parsed && typeof parsed.answers === 'object') restoredAnswers = parsed.answers;
            if (parsed && typeof parsed.flagged === 'object') restoredFlags = parsed.flagged;
            if (Object.keys(restoredAnswers).length > 0) {
              this.showToast('تم استرجاع إجاباتك المحفوظة تلقائياً لهذه الجلسة.', 'success');
            }
          }
        } catch {}

        this.activeAssessmentSession = {
          assessment: data.assessment,
          questions: data.questions,
          answers: restoredAnswers,
          flagged: restoredFlags,
          remainingSeconds: Number(data.assessment.remaining_seconds || data.assessment.time_limit_minutes * 60)
        };
        this.renderAssessmentArena();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        this.showToast(err.message, 'danger');
        this.renderStudentPortal();
      }
    },

    renderQuestionNavigatorHtml(sess) {
      return `
        <div class="qnav-panel">
          <div class="card-meta-row" style="margin-bottom:0;">
            <span style="font-weight:800; color:var(--gold-400); font-size:0.88rem; display:flex; align-items:center; gap:6px;">
              ${this.icon('compass', 16)} <span>خريطة أرقام الأسئلة</span>
            </span>
            <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:0.74rem; color:var(--text-secondary);">
              <span style="color:var(--success-text);">● تم حله (${Object.keys(sess.answers || {}).length})</span>
              <span style="color:#f59e0b;">● معلّم للمراجعة (${Object.values(sess.flagged || {}).filter(Boolean).length})</span>
              <span>● لم يُحل (${sess.questions.length - Object.keys(sess.answers || {}).length})</span>
            </div>
          </div>
          <div class="qnav-grid" id="examQuestionNavGrid">
            ${sess.questions.map((q) => {
              const isAnswered = sess.answers && sess.answers[q.id] !== undefined;
              const isFlagged = sess.flagged && Boolean(sess.flagged[q.id]);
              const cls = isFlagged ? 'flagged' : (isAnswered ? 'answered' : '');
              return `
                <button type="button" id="qnav_pill_${Number(q.id)}" class="qnav-pill ${cls}" data-click="scrollToQuestion" data-id="${Number(q.id)}">
                  <span>${Number(q.display_number)}</span>
                  ${isFlagged ? this.icon('flag', 12) : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    },

    updateQuestionNavPill(questionId) {
      const sess = this.activeAssessmentSession;
      if (!sess) return;
      const pill = document.getElementById(`qnav_pill_${Number(questionId)}`);
      if (!pill) return;
      const isAnswered = sess.answers && sess.answers[questionId] !== undefined;
      const isFlagged = sess.flagged && Boolean(sess.flagged[questionId]);
      pill.classList.toggle('flagged', isFlagged);
      pill.classList.toggle('answered', !isFlagged && isAnswered);
      const qObj = sess.questions.find((x) => x.id === questionId);
      const num = qObj ? qObj.display_number : '';
      pill.innerHTML = `<span>${Number(num)}</span>${isFlagged ? this.icon('flag', 12) : ''}`;
    },

    scrollToQuestion(questionId) {
      const el = document.getElementById(`qbox_${Number(questionId)}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    toggleQuestionFlag(questionId) {
      const sess = this.activeAssessmentSession;
      if (!sess) return;
      if (!sess.flagged) sess.flagged = {};
      sess.flagged[questionId] = !sess.flagged[questionId];
      this.saveExamDraftToStorage();
      this.updateQuestionNavPill(questionId);
      const btn = document.getElementById(`qflag_btn_${Number(questionId)}`);
      if (btn) {
        const flagged = Boolean(sess.flagged[questionId]);
        btn.classList.toggle('btn-gold', flagged);
        btn.classList.toggle('btn-outline-gold', !flagged);
        btn.innerHTML = `${this.icon('flag', 13)} <span>${flagged ? 'معلّم للمراجعة' : 'تعلّم للمراجعة'}</span>`;
      }
    },

    renderAssessmentArena() {
      const sess = this.activeAssessmentSession;
      if (!sess) return;

      const root = document.getElementById('appRoot');
      root.innerHTML = `
        <div class="container fade-in">
          <div class="exam-timer-bar">
            <div style="flex:1; min-width:200px;">
              <span class="badge badge-gold">${this.icon('sparkles', 12)} <span>ترتيب عشوائي للأسئلة • حفظ تلقائي</span></span>
              <h3 style="color:var(--text-primary); font-size:1.1rem; margin-top:4px;">${this.esc(sess.assessment.title)}</h3>
            </div>
            <div style="text-align:center; background:var(--bg-main); padding:6px 14px; border-radius:10px; border:1px solid var(--gold-500);">
              <div style="font-size:0.72rem; color:var(--gold-300);">الوقت المتبقي</div>
              <div id="examTimerCountdown" style="font-size:1.4rem; font-weight:900; color:var(--success-text); font-variant-numeric:tabular-nums;">
                ${String(Math.floor(sess.remainingSeconds / 60)).padStart(2, '0')}:${String(sess.remainingSeconds % 60).padStart(2, '0')}
              </div>
            </div>
          </div>

          ${this.renderQuestionNavigatorHtml(sess)}

          <div id="questionsContainer">
            ${sess.questions.map((q) => {
              const isTrueFalse = q.question_type === 'true_false';
              const savedVal = sess.answers ? sess.answers[q.id] : undefined;
              const isFlagged = sess.flagged && Boolean(sess.flagged[q.id]);
              return `
              <div class="question-box" id="qbox_${Number(q.id)}">
                <div class="card-meta-row">
                  <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <span class="badge badge-gold">السؤال ${Number(q.display_number)} من ${sess.questions.length} • ${this.esc(q.topic_tag)}</span>
                    <span class="badge ${isTrueFalse ? 'badge-success' : 'badge-gold'}">${isTrueFalse ? 'صح أم خطأ' : 'اختيار من متعدد'}</span>
                  </div>
                  <div style="display:flex; gap:8px; align-items:center;">
                    <button type="button" id="qflag_btn_${Number(q.id)}" class="btn btn-sm ${isFlagged ? 'btn-gold' : 'btn-outline-gold'}" data-click="toggleQuestionFlag" data-id="${Number(q.id)}">
                      ${this.icon('flag', 13)} <span>${isFlagged ? 'معلّم للمراجعة' : 'تعلّم للمراجعة'}</span>
                    </button>
                    <span style="font-size:0.8rem; color:var(--gold-300); font-weight:700;">(${Number(q.points)} درجات)</span>
                  </div>
                </div>
                <h4 style="font-size:1.05rem; color:var(--text-primary); margin-bottom:10px; line-height:1.6;">${this.esc(q.question_text)}</h4>
                <div class="${isTrueFalse ? 'grid-2' : ''}">
                  ${q.options.map((opt, oIdx) => `
                    <div
                      class="option-label ${savedVal === opt ? 'selected' : ''}"
                      id="opt_${Number(q.id)}_${oIdx}"
                      data-click="selectMcqOption"
                      data-id="${Number(q.id)}"
                      data-oindex="${oIdx}"
                    >
                      <span class="option-letter-circle">${isTrueFalse ? (opt === 'صح' ? this.icon('check', 15) : this.icon('x', 15)) : (['أ', 'ب', 'ج', 'د'][oIdx] || oIdx + 1)}</span>
                      <span style="flex:1; min-width:0; font-weight:${isTrueFalse ? '800' : '600'};">${this.esc(opt)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
              `;
            }).join('')}
          </div>

          <div class="card-meta-row" style="margin-top:22px;">
            <button class="btn btn-danger" data-click="navigateHome">إلغاء والعودة</button>
            <button class="btn btn-gold" style="padding:12px 28px;" data-click="submitAssessment">${this.icon('check-circle', 16)} <span>تسليم الإجابات والتصحيح الفوري</span></button>
          </div>
        </div>
      `;

      if (this.examTimerInterval) clearInterval(this.examTimerInterval);
      this.examTimerInterval = setInterval(() => {
        sess.remainingSeconds--;
        const timerEl = document.getElementById('examTimerCountdown');
        if (timerEl) {
          const m = String(Math.floor(Math.max(0, sess.remainingSeconds) / 60)).padStart(2, '0');
          const s = String(Math.max(0, sess.remainingSeconds) % 60).padStart(2, '0');
          timerEl.textContent = `${m}:${s}`;
          if (sess.remainingSeconds <= 60) timerEl.style.color = '#f43f5e';
        }
        if (sess.remainingSeconds <= 0) {
          clearInterval(this.examTimerInterval);
          this.showToast('انتهى الوقت المحدد للامتحان! جاري تسليم إجاباتك تلقائياً...', 'warning');
          this.submitAssessment();
        }
      }, 1000);
    },

    selectMcqOptionByIndex(questionId, selectedIdx) {
      if (!this.activeAssessmentSession) return;
      const q = this.activeAssessmentSession.questions.find((item) => item.id === questionId);
      if (!q) return;
      this.activeAssessmentSession.answers[questionId] = q.options[selectedIdx];
      this.saveExamDraftToStorage();
      this.updateQuestionNavPill(questionId);
      for (let i = 0; i < q.options.length; i++) {
        const el = document.getElementById(`opt_${questionId}_${i}`);
        if (el) el.classList.toggle('selected', i === selectedIdx);
      }
    },

    async submitAssessment() {
      if (!this.activeAssessmentSession || this._isSubmittingAssessment) return;
      this._isSubmittingAssessment = true;
      const sess = this.activeAssessmentSession;
      const submitBtn = document.querySelector('[data-click="submitAssessment"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري تسليم الإجابات...';
      }

      try {
        const res = await this.api(`/api/assessments/${Number(sess.assessment.id)}/submit`, {
          method: 'POST',
          body: JSON.stringify({ answers: sess.answers })
        });

        this.clearExamDraftStorage(sess.assessment);
        if (this.examTimerInterval) clearInterval(this.examTimerInterval);
        const lessonObj = (this.studentDashboardData?.lessons || []).find((l) => l.id === sess.assessment.lesson_id);
        this._lastAssessmentResult = {
          ...res,
          assessment_title: sess.assessment.title,
          lesson_title: sess.assessment.lesson_title,
          subject: lessonObj ? lessonObj.subject : undefined
        };
        this.activeAssessmentSession = null;
        await this.loadStudentPortal(true);
        this.renderAssessmentResult(this._lastAssessmentResult);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        this.showToast(err.message, 'danger');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `${this.icon('check-circle', 16)} <span>تسليم الإجابات والتصحيح الفوري</span>`;
        }
      } finally {
        this._isSubmittingAssessment = false;
      }
    },

    async generateCertificateCanvasBlob(sub) {
      const canvas = document.createElement('canvas');
      canvas.width = 1400;
      canvas.height = 980;
      const ctx = canvas.getContext('2d');

      const grad = ctx.createLinearGradient(0, 0, 1400, 980);
      grad.addColorStop(0, '#04170f');
      grad.addColorStop(0.5, '#0a3324');
      grad.addColorStop(1, '#04150e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1400, 980);

      // Double gold ornate border
      ctx.strokeStyle = '#d4b26a';
      ctx.lineWidth = 10;
      ctx.strokeRect(36, 36, 1328, 908);
      ctx.strokeStyle = '#f5e4be';
      ctx.lineWidth = 2;
      ctx.strokeRect(56, 56, 1288, 868);

      // Load logo safely if available
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.save();
          ctx.beginPath();
          ctx.arc(700, 160, 68, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, 632, 92, 136, 136);
          ctx.restore();
          ctx.strokeStyle = '#d4b26a';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(700, 160, 70, 0, Math.PI * 2);
          ctx.stroke();
          resolve();
        };
        img.onerror = resolve;
        img.src = '/assets/logo.png';
      });

      ctx.textAlign = 'center';
      ctx.fillStyle = '#d4b26a';
      ctx.font = '700 50px "Thmanyah Serif Display", "Thmanyah Sans", serif';
      ctx.fillText('شهادة تقدير وتفوق علمي', 700, 300);

      ctx.fillStyle = '#a9c2b5';
      ctx.font = '400 26px "Thmanyah Sans", sans-serif';
      ctx.fillText(`تتشرف ${this.publicSettings?.platform_name || 'منصة مَتْن (MATN)'} بمنح هذه الشهادة للطالب المتفوق:`, 700, 365);

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 46px "Thmanyah Serif Display", "Thmanyah Sans", serif';
      ctx.fillText(String(this.user?.full_name || ''), 700, 445);

      const subjName = sub.subject
        ? (SUBJECTS_META[sub.subject]?.name || sub.subject)
        : 'المواد الشرعية';
      ctx.fillStyle = '#f5e4be';
      ctx.font = '700 30px "Thmanyah Sans", sans-serif';
      ctx.fillText(`لتفوقه المتميز في اختبار: ${sub.assessment_title || 'امتحان الحصة'} (${subjName})`, 700, 525);

      // Score badge
      ctx.fillStyle = 'rgba(212, 178, 106, 0.16)';
      ctx.fillRect(430, 570, 540, 100);
      ctx.strokeStyle = '#d4b26a';
      ctx.lineWidth = 2;
      ctx.strokeRect(430, 570, 540, 100);
      ctx.fillStyle = '#6ee7b7';
      ctx.font = '700 38px "Thmanyah Sans", sans-serif';
      ctx.fillText(`الدرجة: ${Number(sub.score)} / ${Number(sub.total_points)}  ·  النسبة: ${Number(sub.percentage)}%`, 700, 634);

      const dateStr = new Date(sub.submitted_at || Date.now()).toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      ctx.fillStyle = '#a9c2b5';
      ctx.font = '400 24px "Thmanyah Sans", sans-serif';
      ctx.fillText(`تاريخ الإصدار: ${dateStr}`, 330, 825);

      ctx.fillStyle = '#e5c687';
      ctx.font = '700 28px "Thmanyah Serif Text", "Thmanyah Sans", serif';
      ctx.fillText(`توقيع المعلم: ${this.publicSettings?.teacher_name || 'الأستاذ محمد عبد الله'}`, 1030, 825);

      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    },

    resolveCertificateTarget(submissionId) {
      if (submissionId && this.studentDashboardData?.submissions) {
        const found = this.studentDashboardData.submissions.find(
          (s) => Number(s.id) === Number(submissionId) || Number(s.submission_id) === Number(submissionId)
        );
        if (found) return found;
      }
      if (this._lastAssessmentResult && (!submissionId || Number(this._lastAssessmentResult.submission_id) === Number(submissionId))) {
        return this._lastAssessmentResult;
      }
      return null;
    },

    async downloadCertificate(submissionId) {
      const target = this.resolveCertificateTarget(submissionId);
      if (!target || Number(target.percentage) < 90) {
        this.showToast('شهادة التقدير متاحة فقط عند تحقيق نسبة 90% فأكثر.', 'warning');
        return;
      }
      const blob = await this.generateCertificateCanvasBlob(target);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `شهادة-تقدير-${Number(target.submission_id || Date.now())}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.showToast('تم تحميل شهادة التقدير بنجاح.', 'success');
    },

    async shareCertificate(submissionId) {
      const target = this.resolveCertificateTarget(submissionId);
      if (!target || Number(target.percentage) < 90) return;
      const blob = await this.generateCertificateCanvasBlob(target);
      if (!blob) return;
      const file = new File([blob], 'matn-certificate.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'شهادة تقدير — منصة مَتْن',
            text: `حصلت على ${Number(target.percentage)}% في ${target.assessment_title || 'الاختبار'} على منصة مَتْن!`,
            files: [file]
          });
          return;
        } catch {}
      }
      await this.downloadCertificate(submissionId);
    },

    async viewSubmissionReview(submissionId) {
      try {
        const res = await this.api(`/api/submissions/${Number(submissionId)}/review`);
        const items = res.detailed_review || [];
        this.openModal(`
          <div class="card-meta-row">
            <h3 style="color:var(--gold-400); font-size:1.08rem; display:flex; align-items:center; gap:8px;">${this.icon('book-open', 18)} <span>مراجعة: ${this.esc(res.assessment_title)} (${Number(res.score)}/${Number(res.total_points)})</span></h3>
            <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon('x', 14)} <span>إغلاق</span></button>
          </div>
          <div style="max-height:65vh; overflow-y:auto;">
            ${items.length === 0 ? `<p style="text-align:center; color:var(--text-secondary);">لا توجد تفاصيل إجابات مسجلة لهذه المحاولة.</p>` : items.map((r, idx) => `
              <div class="question-box" style="margin-bottom:10px; border-color:${r.is_correct ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'};">
                <div class="card-meta-row">
                  <span class="badge ${r.is_correct ? 'badge-success' : 'badge-danger'}">${r.is_correct ? 'صحيحة' : 'خاطئة'} • ${this.esc(r.topic_tag)}</span>
                  <span style="color:var(--gold-400); font-weight:800;">${Number(r.points_earned)}/${Number(r.points_total)}</span>
                </div>
                <div style="font-weight:700; margin-bottom:6px;">${idx + 1}- ${this.esc(r.question_text)}</div>
                <div style="font-size:0.84rem;">إجابتك: <b>${this.esc(r.selected_option)}</b></div>
                ${!r.is_correct ? `<div style="font-size:0.84rem; color:var(--success-text);">الصحيحة: <b>${this.esc(r.correct_option)}</b></div>` : ''}
                ${r.explanation ? `<div style="font-size:0.8rem; color:var(--gold-300); margin-top:4px;">التعليل: ${this.esc(r.explanation)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        `, '720px');
      } catch (err) {
        this.showToast(err.message, 'warning');
      }
    },

    renderAssessmentResult(result) {
      const root = document.getElementById('appRoot');
      const reviewList = Array.isArray(result.detailed_review) ? result.detailed_review : [];
      const qualifiesCertificate = Number(result.percentage) >= 90;
      root.innerHTML = `
        <div class="container fade-in">
          <div class="section-card" style="text-align:center; border-color:${result.passed ? '#10b981' : '#f43f5e'};">
            <div style="color:${result.passed ? 'var(--emerald-accent)' : 'var(--danger)'}; margin-bottom:6px;">
              ${this.icon(result.passed ? 'trophy' : 'alert-triangle', 42)}
            </div>
            <h2 style="color:${result.passed ? 'var(--success-text)' : 'var(--danger-text)'}; margin:8px 0; font-size:1.3rem;">
              ${result.passed ? 'ناجح ومجتاز للاختبار (فوق النصف)' : 'لم تتجاوز شرط النجاح (مطلوب فوق النصف ولو بدرجة)'}
            </h2>
            <p style="font-size:0.92rem; color:var(--text-primary); max-width:650px; margin:0 auto 18px;">
              ${this.esc(result.message)}
            </p>

            <div class="grid-3" style="max-width:740px; margin:0 auto 20px;">
              <div class="stat-box">
                <span class="stat-label">درجتك النهائية</span>
                <span class="stat-value">${Number(result.score)} / ${Number(result.total_points)}</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">الحد الأدنى للنجاح</span>
                <span class="stat-value">${Number(result.minimum_to_pass)} درجات</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">النسبة المئوية</span>
                <span class="stat-value">${Number(result.percentage)}%</span>
              </div>
            </div>

            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
              ${qualifiesCertificate ? `
                <button type="button" class="btn btn-gold" data-click="downloadCertificate" data-id="${Number(result.submission_id || 0)}">
                  ${this.icon('download', 16)} <span>تحميل شهادة التقدير (PNG)</span>
                </button>
                <button type="button" class="btn btn-emerald" data-click="shareCertificate" data-id="${Number(result.submission_id || 0)}">
                  ${this.icon('share', 16)} <span>مشاركة الشهادة</span>
                </button>
              ` : ''}
              <button class="btn btn-outline-gold" data-click="navigateHome">${this.icon('arrow-right', 15)} <span>العودة إلى المحاضرات والمنهج</span></button>
            </div>
          </div>

          ${result.answers_hidden ? `
            <div class="section-card" style="text-align:center; border-color:var(--border-gold);">
              <h3 style="color:var(--gold-400); margin-bottom:8px;">نموذج الإجابة والتعليل محجوب مؤقتاً</h3>
              <p style="font-size:0.88rem; color:var(--text-secondary);">
                حفاظاً على نزاهة الامتحان، ستظهر الإجابات الصحيحة والتعليل الشرعي تلقائياً في تبويب «درجاتي» وبنك الأخطاء بعد انتهاء الموعد المحدد في:
                <b>${this.esc(result.review_available_at ? new Date(result.review_available_at).toLocaleString('ar-EG') : '')}</b>
              </p>
            </div>
          ` : (reviewList.length > 0 ? `
            <div class="section-card">
              <div class="section-header">
                <h3 class="section-title">${this.icon('book-open', 19)} <span>نموذج التصحيح التفصيلي والتعليل الشرعي</span></h3>
              </div>
              ${reviewList.map((r, idx) => `
                <div class="question-box" style="border-color:${r.is_correct ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'};">
                  <div class="card-meta-row">
                    <span class="badge ${r.is_correct ? 'badge-success' : 'badge-danger'}">
                      ${r.is_correct ? 'إجابة صحيحة' : 'إجابة خاطئة'} • ${this.esc(r.topic_tag)}
                    </span>
                    <span style="font-weight:800; color:var(--gold-400);">${Number(r.points_earned)} / ${Number(r.points_total)}</span>
                  </div>
                  <h4 style="margin-bottom:8px; font-size:0.98rem;">${idx + 1}- ${this.esc(r.question_text)}</h4>
                  <div style="font-size:0.86rem; margin-bottom:4px;">
                    إجابتك: <b style="color:${r.is_correct ? 'var(--success-text)' : 'var(--danger-text)'};">${this.esc(r.selected_option)}</b>
                  </div>
                  ${!r.is_correct ? `<div style="font-size:0.86rem; margin-bottom:4px;">الإجابة الصحيحة: <b style="color:var(--success-text);">${this.esc(r.correct_option)}</b></div>` : ''}
                  ${r.explanation ? `
                    <div style="background:rgba(212,178,106,0.1); border-right:3px solid var(--gold-400); padding:8px 12px; border-radius:6px; font-size:0.82rem; color:var(--gold-300); margin-top:8px;">
                      التعليل الشرعي: ${this.esc(r.explanation)}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : '')}
        </div>
      `;
    }
  });
}
