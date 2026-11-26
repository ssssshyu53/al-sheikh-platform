import { SUBJECTS_META, GRADES_META, BRANCHES_META } from './constants.js';

export function registerAdminMethods(proto) {
  Object.assign(proto, {
    async loadAdminDashboard(silent = false, restoreFocusId = null) {
      this.currentView = 'admin_dashboard';
      const root = document.getElementById('appRoot');
      if (!silent && !this.adminData) {
        root.innerHTML = this.renderSkeletonView('جاري فتح استوديو الإدارة...');
      }

      try {
        const qs = new URLSearchParams({
          students_limit: String(this.adminPageSize),
          students_offset: String(this.adminStudentsOffset),
          students_q: this.adminStudentsQuery || '',
          students_filter: this.adminStudentsFilter || 'all',
          vouchers_limit: String(this.adminPageSize),
          vouchers_offset: String(this.adminVouchersOffset),
          vouchers_q: this.adminVouchersQuery || '',
          vouchers_filter: this.adminVouchersFilter || 'all'
        }).toString();
        this.adminData = await this.api(`/api/admin/overview?${qs}`);
        if (this.adminData.platform_settings) {
          this.publicSettings = { ...this.publicSettings, ...this.adminData.platform_settings };
          this.syncPublicBrandingElements();
        }
        this.renderAdminDashboard();
        if (restoreFocusId) {
          const focusEl = document.getElementById(restoreFocusId);
          if (focusEl) {
            focusEl.focus();
            try {
              const len = focusEl.value.length;
              focusEl.setSelectionRange(len, len);
            } catch {}
          }
        }
      } catch (err) {
        root.innerHTML = `<div class="container"><div class="section-card"><h3 style="color:var(--danger);">${this.esc(err.message)}</h3></div></div>`;
      }
    },

    switchAdminTab(tab, updateHash = true) {
      this.stopActiveMediaLoops();
      this.activeLessonId = null;
      this.adminTab = tab || 'lessons_list';
      if (updateHash) {
        this.setHashRoute(this.adminTab === 'lessons_list' ? '/admin' : `/admin/${this.adminTab}`);
      }
      this.renderAdminDashboard();
    },

    renderAdminDashboard() {
      const root = document.getElementById('appRoot');
      const d = this.adminData;
      const totalStudents = Number(d.students_all_count ?? d.students_total ?? d.students.length);
      const totalVouchers = Number(d.vouchers_total ?? d.vouchers.length);
      const pendingQuestions = Number(d.pending_questions_count || 0);
      const liveSessionsCount = (d.live_sessions || []).length;

      this.mobileDrawerOpen = false;
      document.body.classList.remove('drawer-open');

      root.innerHTML = `
        <div class="app-shell fade-in">
          <div id="sidebarDrawerBackdrop" class="sidebar-drawer-backdrop" data-click="closeMobileSidebar" aria-hidden="true"></div>
          <aside class="app-sidebar no-print" aria-label="قائمة الإدارة">
            <div class="sidebar-scroll-body">
              <div class="sidebar-profile">
                <img src="/assets/logo.png" alt="شعار منصة متن" class="sidebar-profile-avatar" />
                <div class="sidebar-profile-meta">
                  <strong class="sidebar-profile-name">${this.esc(this.user.full_name || 'لوحة الإدارة')}</strong>
                  <span class="sidebar-profile-sub">استوديو الإدارة الشاملة</span>
                  <span class="sidebar-status-line is-active" dir="ltr">
                    ${this.icon('crown', 12)}
                    <span>${this.esc(this.user.phone || '')}</span>
                  </span>
                </div>
                <button type="button" class="sidebar-drawer-close" data-click="closeMobileSidebar" aria-label="إغلاق القائمة">
                  ${this.icon('x', 16)}
                </button>
              </div>

              <div class="sidebar-group">
                <div class="sidebar-group-label">المحتوى التعليمي</div>
                <nav class="sidebar-nav">
                  <button type="button" class="sidebar-link ${this.adminTab === 'lessons_list' && !this.activeLessonId ? 'active' : ''}" data-click="switchAdminTab" data-arg="lessons_list">
                    <span class="nav-icon">${this.icon('book', 17)}</span>
                    <span class="sidebar-link-label">المحاضرات والإحصائيات</span>
                    <span class="sidebar-count">${d.lessons.length}</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'add_lesson' ? 'active' : ''}" data-click="switchAdminTab" data-arg="add_lesson">
                    <span class="nav-icon">${this.icon('plus', 17)}</span>
                    <span class="sidebar-link-label">رفع محاضرة ومذكرة</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'exams' ? 'active' : ''}" data-click="switchAdminTab" data-arg="exams">
                    <span class="nav-icon">${this.icon('file-text', 17)}</span>
                    <span class="sidebar-link-label">إنشاء امتحان أو واجب</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'live_sessions' ? 'active' : ''}" data-click="switchAdminTab" data-arg="live_sessions">
                    <span class="nav-icon">${this.icon('radio', 17)}</span>
                    <span class="sidebar-link-label">الحصص المباشرة</span>
                    ${liveSessionsCount > 0 ? `<span class="sidebar-count is-accent">${liveSessionsCount}</span>` : ''}
                  </button>
                </nav>
              </div>

              <div class="sidebar-group">
                <div class="sidebar-group-label">الطلاب والمتابعة</div>
                <nav class="sidebar-nav">
                  <button type="button" class="sidebar-link ${this.adminTab === 'students' ? 'active' : ''}" data-click="switchAdminTab" data-arg="students">
                    <span class="nav-icon">${this.icon('users', 17)}</span>
                    <span class="sidebar-link-label">الطلاب والأجهزة</span>
                    <span class="sidebar-count">${totalStudents}</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'retakes' ? 'active' : ''}" data-click="switchAdminTab" data-arg="retakes">
                    <span class="nav-icon">${this.icon('alert-triangle', 17)}</span>
                    <span class="sidebar-link-label">الراسبون والملحق</span>
                    ${d.failed_submissions.length > 0 ? `<span class="sidebar-count is-danger">${d.failed_submissions.length}</span>` : ''}
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'questions' ? 'active' : ''}" data-click="switchAdminTab" data-arg="questions">
                    <span class="nav-icon">${this.icon('help-circle', 17)}</span>
                    <span class="sidebar-link-label">أسئلة الطلاب</span>
                    ${pendingQuestions > 0 ? `<span class="sidebar-count is-accent">${pendingQuestions}</span>` : ''}
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'weekly_reports' ? 'active' : ''}" data-click="switchAdminTab" data-arg="weekly_reports">
                    <span class="nav-icon">${this.icon('calendar', 17)}</span>
                    <span class="sidebar-link-label">متابعة الجمعة للأهل</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'notifications' ? 'active' : ''}" data-click="switchAdminTab" data-arg="notifications">
                    <span class="nav-icon">${this.icon('bell', 17)}</span>
                    <span class="sidebar-link-label">إشعارات الطلاب</span>
                  </button>
                </nav>
              </div>

              <div class="sidebar-group">
                <div class="sidebar-group-label">الاشتراكات والنظام</div>
                <nav class="sidebar-nav">
                  <button type="button" class="sidebar-link ${this.adminTab === 'vouchers' ? 'active' : ''}" data-click="switchAdminTab" data-arg="vouchers">
                    <span class="nav-icon">${this.icon('ticket', 17)}</span>
                    <span class="sidebar-link-label">كروت الشحن</span>
                    <span class="sidebar-count">${totalVouchers}</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'security' ? 'active' : ''}" data-click="switchAdminTab" data-arg="security">
                    <span class="nav-icon">${this.icon('shield', 17)}</span>
                    <span class="sidebar-link-label">الحماية والسجلات</span>
                  </button>
                  <button type="button" class="sidebar-link ${this.adminTab === 'settings' ? 'active' : ''}" data-click="switchAdminTab" data-arg="settings">
                    <span class="nav-icon">${this.icon('settings', 17)}</span>
                    <span class="sidebar-link-label">إعدادات المنصة</span>
                  </button>
                </nav>
              </div>
            </div>

            <div class="sidebar-footer">
              <button type="button" class="btn btn-outline-gold btn-sm btn-block" data-click="loadAdminDashboard">${this.icon('refresh', 15)} <span>تحديث البيانات</span></button>
            </div>
          </aside>

          <section class="app-main">
            ${d.admin_phone_matches_support ? `
              <div class="section-card no-print" style="border-color:var(--warning); background:rgba(196,154,58,0.12); padding:12px 16px; margin-bottom:16px;">
                <div style="font-weight:700; color:var(--warning-text); font-size:0.88rem; display:flex; align-items:center; gap:8px;">
                  ${this.icon('alert-triangle', 17)}
                  <span>تحذير أمني: رقم واتساب الدعم الظاهر للطلاب مطابق لرقم دخول الأدمن (${this.esc(this.user.phone)})! يُنصح بتغييره من تبويب «إعدادات المنصة».</span>
                </div>
              </div>
            ` : ''}
            ${(d.admin_security_alerts || []).length > 0 ? `
              <div class="section-card no-print" style="border-color:#f43f5e; background:rgba(136,19,55,0.28); padding:12px 16px; margin-bottom:16px;">
                <div style="font-weight:800; color:var(--danger-text); font-size:0.88rem; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                  ${this.icon('alert-triangle', 17)}
                  <span>تنبيه أمني خلال آخر ٢٤ ساعة (${d.admin_security_alerts.length}): تم رصد محاولات دخول فاشلة متكررة!</span>
                </div>
                <div style="font-size:0.8rem; color:var(--text-secondary);">
                  ${this.esc(d.admin_security_alerts[0].details || '')} — راجع تبويب «الحماية والسجلات» للتفاصيل.
                </div>
              </div>
            ` : ''}
            ${this.activeLessonId ? '' : `
              <div class="mobile-admin-tabs no-print" role="navigation" aria-label="تبويبات الإدارة">
                <button class="mobile-admin-chip ${this.adminTab === 'lessons_list' ? 'active' : ''}" data-click="switchAdminTab" data-arg="lessons_list">المحاضرات</button>
                <button class="mobile-admin-chip ${this.adminTab === 'add_lesson' ? 'active' : ''}" data-click="switchAdminTab" data-arg="add_lesson">رفع محاضرة</button>
                <button class="mobile-admin-chip ${this.adminTab === 'live_sessions' ? 'active' : ''}" data-click="switchAdminTab" data-arg="live_sessions">الحصص المباشرة</button>
                <button class="mobile-admin-chip ${this.adminTab === 'notifications' ? 'active' : ''}" data-click="switchAdminTab" data-arg="notifications">الإشعارات</button>
                <button class="mobile-admin-chip ${this.adminTab === 'exams' ? 'active' : ''}" data-click="switchAdminTab" data-arg="exams">الامتحانات</button>
                <button class="mobile-admin-chip ${this.adminTab === 'retakes' ? 'active' : ''}" data-click="switchAdminTab" data-arg="retakes">الراسبون</button>
                <button class="mobile-admin-chip ${this.adminTab === 'students' ? 'active' : ''}" data-click="switchAdminTab" data-arg="students">الطلاب</button>
                <button class="mobile-admin-chip ${this.adminTab === 'vouchers' ? 'active' : ''}" data-click="switchAdminTab" data-arg="vouchers">الأكواد</button>
                <button class="mobile-admin-chip ${this.adminTab === 'weekly_reports' ? 'active' : ''}" data-click="switchAdminTab" data-arg="weekly_reports">تقارير الجمعة</button>
                <button class="mobile-admin-chip ${this.adminTab === 'questions' ? 'active' : ''}" data-click="switchAdminTab" data-arg="questions">أسئلة الطلاب</button>
                <button class="mobile-admin-chip ${this.adminTab === 'security' ? 'active' : ''}" data-click="switchAdminTab" data-arg="security">الحماية</button>
                <button class="mobile-admin-chip ${this.adminTab === 'settings' ? 'active' : ''}" data-click="switchAdminTab" data-arg="settings">الإعدادات</button>
              </div>
            `}
            ${this.activeLessonId ? this.renderUnifiedLessonWorkspace(this.activeLessonId) : this.renderActiveAdminTab()}
          </section>

          <nav class="mobile-bottom-nav no-print">
            <button class="mobile-nav-item ${this.adminTab === 'lessons_list' ? 'active' : ''}" data-click="switchAdminTab" data-arg="lessons_list"><span>${this.icon('book', 18)}</span><span>المحاضرات</span></button>
            <button class="mobile-nav-item ${this.adminTab === 'live_sessions' ? 'active' : ''}" data-click="switchAdminTab" data-arg="live_sessions"><span>${this.icon('radio', 18)}</span><span>مباشر</span></button>
            <button class="mobile-nav-item ${this.adminTab === 'students' ? 'active' : ''}" data-click="switchAdminTab" data-arg="students"><span>${this.icon('users', 18)}</span><span>الطلاب</span></button>
            <button class="mobile-nav-item ${this.adminTab === 'vouchers' ? 'active' : ''}" data-click="switchAdminTab" data-arg="vouchers"><span>${this.icon('ticket', 18)}</span><span>الأكواد</span></button>
            <button class="mobile-nav-item ${this.adminTab === 'settings' ? 'active' : ''}" data-click="switchAdminTab" data-arg="settings"><span>${this.icon('settings', 18)}</span><span>الإعدادات</span></button>
          </nav>
        </div>
      `;
    },

    renderAdminAnalyticsCharts(d) {
      const an = d.analytics || {};
      const growth = Array.isArray(an.subscription_growth) ? an.subscription_growth : [];
      const completion = Array.isArray(an.lesson_completion) ? an.lesson_completion : [];
      const missed = Array.isArray(an.most_missed_questions) ? an.most_missed_questions : [];

      let growthSvg = `<div style="font-size:0.82rem; color:var(--text-secondary); padding:16px 0;">لا توجد اشتراكات مفعّلة مسجلة حتى الآن.</div>`;
      if (growth.length > 0) {
        const w = 540;
        const h = 180;
        const maxVal = Math.max(1, ...growth.map((g) => Number(g.activations || 0)));
        const slotW = (w - 40) / growth.length;
        const barW = Math.min(46, slotW * 0.62);
        growthSvg = `
          <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; display:block;" role="img" aria-label="نمو الاشتراكات النشطة">
            <line x1="20" y1="145" x2="${w - 20}" y2="145" stroke="currentColor" stroke-opacity="0.22"/>
            ${growth.map((g, i) => {
              const cnt = Number(g.activations || 0);
              const barH = Math.max(8, (cnt / maxVal) * 105);
              const x = 20 + i * slotW + (slotW - barW) / 2;
              const y = 145 - barH;
              return `
                <g>
                  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="var(--emerald-accent)">
                    <title>${this.esc(g.ym)}: ${cnt} اشتراك</title>
                  </rect>
                  <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="11" font-weight="bold" text-anchor="middle" fill="var(--gold-300)">${cnt}</text>
                  <text x="${(x + barW / 2).toFixed(1)}" y="165" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.72">${this.esc(g.ym)}</text>
                </g>
              `;
            }).join('')}
          </svg>
        `;
      }

      return `
        <div class="grid-2" style="margin-bottom:20px;">
          <div class="chart-card">
            <div class="card-meta-row" style="margin-bottom:8px;">
              <h4 style="color:var(--gold-400); font-size:0.95rem; display:flex; align-items:center; gap:6px;">${this.icon('bar-chart', 17)} <span>نمو الاشتراكات النشطة شهرياً</span></h4>
              <span class="badge badge-success">نشط حالياً: ${Number(an.active_subscriptions_count || 0)}</span>
            </div>
            ${growthSvg}
          </div>

          <div class="chart-card">
            <h4 style="color:var(--gold-400); font-size:0.95rem; margin-bottom:10px; display:flex; align-items:center; gap:6px;">${this.icon('play', 16)} <span>نسب إتمام المحاضرات</span></h4>
            ${completion.length === 0 ? `<div style="font-size:0.82rem; color:var(--text-secondary);">لا توجد بيانات مشاهدة مسجلة بعد.</div>` : completion.slice(0, 5).map((lc) => `
              <div style="margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:0.79rem; margin-bottom:4px; gap:8px;">
                  <span style="font-weight:700;">${this.esc(lc.title)}</span>
                  <span style="color:var(--gold-300); font-weight:800;">${Number(lc.avg_watch_percent || 0)}% (${Number(lc.learners_count || 0)} طالب)</span>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width:${Math.min(100, Number(lc.avg_watch_percent || 0))}%;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${missed.length > 0 ? `
          <div class="section-card" style="margin-bottom:20px;">
            <div class="section-header" style="margin-bottom:12px;">
              <h4 class="section-title" style="font-size:0.98rem;">${this.icon('alert-triangle', 17)} <span>أكثر الأسئلة التي يخطئ فيها الطلاب (${missed.length})</span></h4>
            </div>
            <div style="display:grid; gap:8px;">
              ${missed.slice(0, 6).map((mq, idx) => `
                <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                  <div style="flex:1; min-width:220px;">
                    <div style="font-weight:700; font-size:0.86rem; color:var(--text-primary);">${idx + 1}. ${this.esc(mq.question_text)}</div>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">${this.esc(mq.lesson_title)} • المبحث: ${this.esc(mq.topic_tag)}</div>
                  </div>
                  <span class="badge badge-danger">${Number(mq.wrong_count)} خطأ (${Number(mq.wrong_rate)}% من المحاولات)</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
    },

    renderActiveAdminTab() {
      const d = this.adminData;
      const totalStudents = Number(d.students_total ?? d.students.length);
      const totalAllStudents = Number(d.students_all_count ?? totalStudents);
      const totalVouchers = Number(d.vouchers_total ?? d.vouchers.length);
      const unusedVouchers = Number(d.vouchers_unused_count ?? d.vouchers.filter((v) => !v.is_used).length);
      const rev = d.revenue_summary || { total_revenue_egp: 0, month_revenue_egp: 0, month_used_vouchers: 0, total_used_vouchers: 0 };

      if (this.adminTab === 'lessons_list') {
        const filteredLessons = this.adminGradeFilter === 'all'
          ? d.lessons
          : d.lessons.filter((l) => l.grade === this.adminGradeFilter);

        return `
          <div class="fade-in">
            <div class="grid-4" style="margin-bottom:20px;">
              <div class="stat-box">
                <span class="stat-label">المحاضرات والطلاب</span>
                <span class="stat-value">${d.lessons.length} محاضرة • ${totalAllStudents} طالب</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">إيراد هذا الشهر (الأكواد المفعّلة)</span>
                <span class="stat-value" style="color:var(--success-text);">${Number(rev.month_revenue_egp || 0).toLocaleString('ar-EG')} ج.م</span>
                <span style="font-size:0.74rem; color:var(--text-secondary);">الإجمالي: ${Number(rev.total_revenue_egp || 0).toLocaleString('ar-EG')} ج.م (${Number(rev.total_used_vouchers || 0)} كود)</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">أكواد متاحة / اشتراكات تنتهي قريباً</span>
                <span class="stat-value">${unusedVouchers} متاح</span>
                <span style="font-size:0.74rem; color:var(--warning-text);">ينتهي خلال ٣ أيام: ${Number(d.expiring_soon_count || 0)} طالب</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">الراسبون / أسئلة بانتظار الرد</span>
                <span class="stat-value" style="color:var(--danger-text);">${d.failed_submissions.length} راسب • ${Number(d.pending_questions_count || 0)} سؤال</span>
              </div>
            </div>

            ${this.renderAdminAnalyticsCharts(d)}

            <div class="section-card">
              <div class="section-header" style="gap:10px;">
                <div>
                  <h3 class="section-title">${this.icon("book", 16)} إدارة المحاضرات والاختبارات (${filteredLessons.length})</h3>
                  <p style="font-size:0.8rem; color:var(--text-secondary);">يمكنك تشغيل الفيديو، عرض المذكرة، تعديل البيانات أو إخفاء/نشر المحاضرة والامتحانات</p>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  <select class="form-control" style="width:auto; min-width:190px; padding:7px 12px;" data-change="onAdminFilterGrade">
                    ${this.renderGradeOptions(this.adminGradeFilter, 'جميع الصفوف (إعدادي وثانوي)')}
                  </select>
                  <button class="btn btn-gold btn-sm" data-click="switchAdminTab" data-arg="add_lesson">${this.icon("plus", 15)} رفع محاضرة جديدة</button>
                </div>
              </div>

              ${filteredLessons.length === 0 ? `
                <div style="text-align:center; padding:40px 20px;">
                  <div style="color:var(--gold-400); margin-bottom:10px;">${this.icon('film', 38)}</div>
                  <h4 style="color:var(--gold-400); margin-bottom:8px;">لا توجد محاضرات في هذا القسم حالياً</h4>
                  <button class="btn btn-gold" data-click="switchAdminTab" data-arg="add_lesson">${this.icon("plus", 15)} ارفع محاضرة الآن</button>
                </div>
              ` : `
                <div class="grid-2">
                  ${filteredLessons.map((l) => `
                    <div class="lesson-card" style="${!l.is_published ? 'opacity:0.78; border-color:rgba(244,63,94,0.45);' : ''}">
                      <div>
                        <div class="card-meta-row">
                          <span class="badge badge-gold">${this.esc(this.getSubjectName(l.subject, l.grade))} • الحصة ${Number(l.order_index)}</span>
                          <span class="badge ${l.is_published ? 'badge-success' : 'badge-danger'}">${l.is_published ? 'منشور' : 'مخفي'}</span>
                        </div>
                        <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:4px;">
                          ${this.esc(GRADES_META[l.grade] || l.grade)} (${this.esc(BRANCHES_META[l.branch] || l.branch)})
                        </div>
                        <h4 style="color:var(--gold-400); font-size:1.05rem; margin-bottom:6px;">${this.esc(l.title)}</h4>
                        <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:12px;">
                          الاختبارات: ${l.assessments.length} • المدة: ${Number(l.duration_minutes)} د
                        </div>
                      </div>
                      <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="btn btn-sm btn-gold" data-click="openLessonWorkspace" data-id="${Number(l.id)}" data-arg="video">${this.icon("video", 15)} فيديو</button>
                        <button class="btn btn-sm btn-outline-gold" data-click="openLessonWorkspace" data-id="${Number(l.id)}" data-arg="pdf">${this.icon("book-open", 15)} مذكرة</button>
                        <button class="btn btn-sm btn-outline-gold" data-click="openEditLessonModal" data-id="${Number(l.id)}">${this.icon("edit", 14)} تعديل</button>
                        <button class="btn btn-sm btn-emerald" data-click="openLessonAssessmentsModal" data-id="${Number(l.id)}">${this.icon("file-text", 15)} الاختبارات</button>
                        <button class="btn btn-sm btn-outline-gold" data-click="toggleLessonPublish" data-id="${Number(l.id)}" data-next="${l.is_published ? 0 : 1}">${l.is_published ? 'إخفاء' : 'نشر'}</button>
                        <button class="btn btn-sm btn-danger" data-click="deleteLesson" data-id="${Number(l.id)}">${this.icon("trash", 14)}</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'add_lesson') {
        const bunnyConfigured = Boolean(d.bunny_stream_configured);
        const bunnyApiReady = Boolean(d.bunny_api_available);
        return `
          <div class="fade-in">
            <div class="section-card" style="max-width:780px; margin:0 auto;">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon("plus", 15)} رفع محاضرة جديدة ومذكرة PDF للمنصة</h3>
                  <p style="font-size:0.8rem; color:var(--text-secondary);">الحد الأقصى للفيديو المحلي: ${Number(d.max_video_upload_mb || 1500)} ميجابايت</p>
                </div>
                <button class="btn btn-outline-gold btn-sm" data-click="switchAdminTab" data-arg="lessons_list">${this.icon("arrow-right", 14)} قائمة المحاضرات</button>
              </div>

              <form data-submit="handleCreateLesson">
                <div class="form-group">
                  <label>عنوان المحاضرة</label>
                  <input type="text" id="newLessonTitle" class="form-control" placeholder="مثال: المحاضرة الأولى: أحكام الطلاق أو السيرة النبوية" required />
                </div>

                <div class="form-row-3">
                  <div class="form-group">
                    <label>المادة الشرعية</label>
                    <select id="newLessonSubject" class="form-control">
                      ${this.renderSubjectOptionsForGrade('grade_3')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>الصف الدراسي</label>
                    <select id="newLessonGrade" class="form-control" data-change="onAdminLessonGradeChange">
                      ${this.renderGradeOptions('grade_3')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>الشعبة / المسار</label>
                    <select id="newLessonBranch" class="form-control">
                      <option value="both">مشترك (علمي وأدبي)</option>
                      <option value="scientific">القسم العلمي فقط</option>
                      <option value="literary">القسم الأدبي فقط</option>
                    </select>
                  </div>
                </div>

                <div class="form-row-3">
                  <div class="form-group">
                    <label>اسم الباب / الوحدة</label>
                    <input type="text" id="newLessonUnit" class="form-control" value="الباب الأول" required />
                  </div>
                  <div class="form-group">
                    <label>ترتيب الحصة</label>
                    <input type="number" id="newLessonOrder" class="form-control" value="${d.lessons.length + 1}" min="1" required />
                  </div>
                  <div class="form-group">
                    <label>المدة (دقيقة)</label>
                    <input type="number" id="newLessonDuration" class="form-control" value="45" min="5" required />
                  </div>
                </div>

                ${bunnyConfigured ? `
                  <div class="form-group">
                    <label>مصدر الفيديو</label>
                    <select id="newLessonVideoType" class="form-control" data-change="onLessonVideoTypeChange">
                      <option value="upload" selected>رفع مباشر على السيرفر</option>
                      <option value="bunny">Bunny Stream (بث سحابي مشفر متعدد الجودات HLS)</option>
                    </select>
                  </div>
                  <div class="form-group" id="bunnyVideoIdGroup" style="display:none; background:rgba(16,185,129,0.08); border:1px solid var(--border-gold); border-radius:12px; padding:12px;">
                    <label>معرف الفيديو على Bunny Stream (Video GUID)</label>
                    <input type="text" id="newLessonBunnyId" class="form-control" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                    ${bunnyApiReady ? `
                      <div style="margin-top:10px;">
                        <label style="font-size:0.8rem;">أو ارفع ملف فيديو مباشرة إلى Bunny Stream (يتم إنشاء الفيديو وجلب المعرف تلقائياً):</label>
                        <input type="file" id="bunnyDirectUploadInput" accept="video/mp4,video/webm" class="form-control" data-change="uploadToBunnyStream" />
                        <div id="bunnyUploadStatus" style="font-size:0.78rem; color:var(--gold-300); margin-top:6px;"></div>
                      </div>
                    ` : ''}
                  </div>
                ` : `<input type="hidden" id="newLessonVideoType" value="upload" />`}

                <div id="localVideoHlsWarning" style="background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.45); color:#fde68a; border-radius:10px; padding:10px 12px; margin-bottom:14px; font-size:0.8rem;">
                  ${this.icon("alert-triangle", 15)} <b>ملاحظة للإنتاج:</b> البث المحلي لا يدعم تعدد الجودات (HLS)؛ يُنصح بتفعيل <b>Bunny Stream</b> في ملف <code>.env</code> عند وجود ضغط طلاب عالٍ.
                </div>

                <div class="grid-2" style="margin-bottom:16px;" id="localVideoUploadGroup">
                  <div class="upload-zone">
                    <div style="color:var(--gold-400); margin-bottom:6px;">${this.icon('film', 26)}</div>
                    <div style="font-weight:800; color:var(--gold-400); font-size:0.9rem; margin-bottom:8px;">١- ملف الفيديو (MP4 / WebM)</div>
                    <input type="file" id="videoFileUploadInput" accept="video/mp4,video/webm" class="form-control" data-change="uploadAdminFile" data-upload-type="video" />
                    <input type="hidden" id="uploadedVideoPath" value="" />
                    <div id="videoProgressWrap" style="display:none; margin-top:10px;">
                      <div style="width:100%; height:10px; background:rgba(255,255,255,0.12); border-radius:99px; overflow:hidden;">
                        <div id="videoProgressBar" style="width:0%; height:100%; background:linear-gradient(90deg, var(--gold-400), #10b981); transition:width 0.2s;"></div>
                      </div>
                    </div>
                    <div id="videoUploadStatus" style="font-size:0.78rem; color:var(--text-secondary); margin-top:8px;">اختر فيديو من جهازك ليُرفع مباشرة</div>
                    ${(d.uploaded_videos && d.uploaded_videos.length > 0) ? `
                      <select class="form-control" style="margin-top:8px; font-size:0.78rem;" data-change="setHiddenValue" data-target-id="uploadedVideoPath">
                        <option value="">-- أو اختر فيديو مرفوعاً مسبقاً (اختياري) --</option>
                        ${d.uploaded_videos.map((v) => `<option value="${this.esc(v.path)}">${this.esc(v.name)} (${this.esc(v.size_mb)} MB)</option>`).join('')}
                      </select>
                    ` : ''}
                  </div>

                  <div class="upload-zone">
                    <div style="color:var(--gold-400); margin-bottom:6px;">${this.icon('file-text', 26)}</div>
                    <div style="font-weight:800; color:var(--gold-400); font-size:0.9rem; margin-bottom:8px;">٢- ملف المذكرة (PDF محمي)</div>
                    <input type="file" id="pdfFileUploadInput" accept="application/pdf,.pdf" class="form-control" data-change="uploadAdminFile" data-upload-type="pdf" />
                    <input type="hidden" id="uploadedPdfPath" value="" />
                    <div id="pdfProgressWrap" style="display:none; margin-top:10px;">
                      <div style="width:100%; height:10px; background:rgba(255,255,255,0.12); border-radius:99px; overflow:hidden;">
                        <div id="pdfProgressBar" style="width:0%; height:100%; background:linear-gradient(90deg, var(--gold-400), #10b981); transition:width 0.2s;"></div>
                      </div>
                    </div>
                    <div id="pdfUploadStatus" style="font-size:0.78rem; color:var(--text-secondary); margin-top:8px;">اختر ملف PDF من جهازك ليُرفع مباشرة</div>
                    ${(d.uploaded_pdfs && d.uploaded_pdfs.length > 0) ? `
                      <select class="form-control" style="margin-top:8px; font-size:0.78rem;" data-change="setHiddenValue" data-target-id="uploadedPdfPath">
                        <option value="">-- أو اختر مذكرة مرفوعة مسبقاً (اختياري) --</option>
                        ${d.uploaded_pdfs.map((p) => `<option value="${this.esc(p.path)}">${this.esc(p.name)} (${this.esc(p.size_mb)} MB)</option>`).join('')}
                      </select>
                    ` : ''}
                  </div>
                </div>

                <button type="submit" id="publishLessonSubmitBtn" class="btn btn-gold" style="width:100%; padding:14px; font-size:1rem;">
                  ${this.icon("zap", 15)} حفظ ونشر المحاضرة والمذكرة للطلاب الآن
                </button>
              </form>
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'live_sessions') {
        const sessions = d.live_sessions || [];
        const defaultStartLocal = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon("radio", 15)} جدولة حصة مباشرة جديدة (Zoom / Meet / YouTube)</h3>
                  <p style="font-size:0.8rem; color:var(--text-secondary);">لا يظهر الرابط إلا للطالب المشترك في الصف والشعبة المحددين وقبل الموعد بـ 15 دقيقة</p>
                </div>
              </div>
              <form data-submit="handleCreateLiveSession">
                <div class="grid-3">
                  <div class="form-group">
                    <label>عنوان الحصة المباشرة</label>
                    <input type="text" id="liveTitle" class="form-control" placeholder="مثال: مراجعة ليلة الامتحان - فقه" required />
                  </div>
                  <div class="form-group">
                    <label>الصف الدراسي</label>
                    <select id="liveGrade" class="form-control" data-change="onLiveGradeChange">
                      ${this.renderGradeOptions('grade_3')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>المادة الشرعية</label>
                    <select id="liveSubject" class="form-control">
                      ${this.renderSubjectOptionsForGrade('grade_3')}
                    </select>
                  </div>
                </div>
                <div class="grid-3">
                  <div class="form-group">
                    <label>الشعبة</label>
                    <select id="liveBranch" class="form-control">
                      <option value="both">مشترك (علمي وأدبي)</option>
                      <option value="scientific">علمي فقط</option>
                      <option value="literary">أدبي فقط</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>موعد البداية</label>
                    <input type="datetime-local" id="liveStartsAt" class="form-control" value="${defaultStartLocal}" required />
                  </div>
                  <div class="form-group">
                    <label>المدة (دقيقة) & المزود</label>
                    <div style="display:flex; gap:6px;">
                      <input type="number" id="liveDuration" class="form-control" value="60" min="10" max="300" required />
                      <select id="liveProvider" class="form-control">
                        <option value="zoom">Zoom</option>
                        <option value="youtube">YouTube Live</option>
                        <option value="meet">Google Meet</option>
                        <option value="other">رابط آخر</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label>رابط البث المحمي (HTTPS)</label>
                    <input type="url" id="liveStreamUrl" class="form-control" placeholder="https://zoom.us/j/..." required />
                  </div>
                  <div class="form-group">
                    <label>وصف مختصر (اختياري)</label>
                    <input type="text" id="liveDescription" class="form-control" placeholder="مراجعة أهم مسائل الباب الأول..." />
                  </div>
                </div>
                <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon("radio", 15)} جدولة الحصة وإشعار الطلاب</button>
              </form>
            </div>

            <div class="section-card">
              <div class="section-header">
                <h3 class="section-title">${this.icon("calendar", 15)} الحصص المباشرة المسجلة (${sessions.length})</h3>
              </div>
              ${sessions.length === 0 ? `<div style="text-align:center; padding:24px; color:var(--text-secondary);">لا توجد حصص مباشرة بعد.</div>` : `
                <div class="grid-2">
                  ${sessions.map((s) => `
                    <div class="lesson-card">
                      <div>
                        <div class="card-meta-row">
                          <span class="badge ${s.status === 'live' ? 'badge-danger' : (s.status === 'ended' ? 'badge-gold' : 'badge-success')}">${this.esc(s.status)}</span>
                          <span class="badge badge-gold">${this.icon("users", 15)} الحضور: ${Number(s.attendance_count || 0)}</span>
                        </div>
                        <h4 style="color:var(--gold-400); margin-bottom:4px;">${this.esc(s.title)}</h4>
                        <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:8px;">
                          ${this.esc(GRADES_META[s.grade] || s.grade)} • ${this.esc(this.getSubjectName(s.subject, s.grade))} • ${this.esc(new Date(s.starts_at).toLocaleString('ar-EG'))}
                        </div>
                      </div>
                      <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-sm btn-emerald" data-click="updateLiveSessionStatus" data-id="${Number(s.id)}" data-arg="live">${this.icon("radio", 15)} بدء الآن</button>
                        <button type="button" class="btn btn-sm btn-outline-gold" data-click="updateLiveSessionStatus" data-id="${Number(s.id)}" data-arg="ended">${this.icon('stop-circle', 14)} <span>إنهاء</span></button>
                        <button type="button" class="btn btn-sm btn-gold" data-click="viewLiveAttendance" data-id="${Number(s.id)}">${this.icon("file-text", 14)} الحضور</button>
                        <button type="button" class="btn btn-sm btn-danger" data-click="deleteLiveSession" data-id="${Number(s.id)}">${this.icon("trash", 14)}</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'notifications') {
        const list = d.notifications || [];
        return `
          <div class="fade-in">
            <div class="section-card" style="max-width:740px; margin:0 auto;">
              <div class="section-header">
                <h3 class="section-title">${this.icon("bell", 15)} إرسال إشعار داخل المنصة للطلاب</h3>
              </div>
              <form data-submit="handleSendAdminNotification">
                <div class="form-row-2">
                  <div class="form-group">
                    <label>عنوان الإشعار</label>
                    <input type="text" id="notifTitle" class="form-control" placeholder="مثال: تنبيه هام لمراجعة الفقه" required />
                  </div>
                  <div class="form-group">
                    <label>الصف المستهدف</label>
                    <select id="notifGrade" class="form-control">
                      ${this.renderGradeOptions('all', 'جميع الصفوف')}
                    </select>
                  </div>
                </div>
                <div class="form-group">
                  <label>الشعبة المستهدفة</label>
                  <select id="notifBranch" class="form-control">
                    <option value="all">جميع الشعب</option>
                    <option value="scientific">القسم العلمي</option>
                    <option value="literary">القسم الأدبي</option>
                    <option value="general">الإعدادي العام</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>نص الإشعار</label>
                  <textarea id="notifBody" class="form-control" rows="3" maxlength="800" placeholder="اكتب التنبيه أو الإعلان للطلاب..." required></textarea>
                </div>
                <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon('send', 15)} <span>إرسال الإشعار الآن</span></button>
              </form>
            </div>

            <div class="section-card" style="max-width:740px; margin:18px auto 0;">
              <div class="section-header">
                <h3 class="section-title">${this.icon('scroll', 17)} <span>آخر الإشعارات المرسلة (${list.length})</span></h3>
              </div>
              <div style="display:flex; flex-direction:column; gap:10px;">
                ${list.length === 0 ? `<div style="color:var(--text-secondary); text-align:center;">لا توجد إشعارات مسجلة بعد.</div>` : list.map((n) => `
                  <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px;">
                    <div class="card-meta-row" style="margin-bottom:4px;">
                      <div>
                        <span class="badge badge-gold">${this.esc(n.notif_type)}</span>
                        <span style="font-weight:800; color:var(--gold-300); margin-right:6px;">${this.esc(n.title)}</span>
                      </div>
                      <button type="button" class="btn btn-danger btn-sm" data-click="deleteAdminNotification" data-id="${Number(n.id)}">${this.icon("trash", 14)}</button>
                    </div>
                    <div style="font-size:0.82rem; color:var(--text-secondary);">${this.esc(n.body)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'exams') {
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <h3 class="section-title">${this.icon("file-text", 15)} إنشاء واجب أو امتحان اختيار من متعدد</h3>
              </div>
              ${d.lessons.length === 0 ? `
                <div style="text-align:center; padding:24px;">يرجى رفع محاضرة أولاً قبل إضافة اختبار لها.</div>
              ` : `
                <form data-submit="handleCreateAssessment">
                  <div class="grid-3">
                    <div class="form-group">
                      <label>المحاضرة المرتبط بها الاختبار</label>
                      <select id="examLessonId" class="form-control" required>
                        ${d.lessons.map((l) => `<option value="${Number(l.id)}">[${this.esc(GRADES_META[l.grade] || l.grade)} • ${this.esc(this.getSubjectName(l.subject, l.grade))}] ${this.esc(l.title)}</option>`).join('')}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>نوع الاختبار</label>
                      <select id="examTypeSelect" class="form-control">
                        <option value="exam">امتحان الحصة الأساسي (النجاح فوق 50%)</option>
                        <option value="homework">واجب الحصة</option>
                        <option value="retake_exam">امتحان إعادة للراسبين (ملحق)</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>المدة (دقيقة)</label>
                      <input type="number" id="examTimeLimit" class="form-control" value="15" min="1" max="180" required />
                    </div>
                  </div>

                  <div class="grid-3">
                    <div class="form-group">
                      <label>عنوان الامتحان / الواجب</label>
                      <input type="text" id="examTitleInput" class="form-control" placeholder="مثال: امتحان المحاضرة الأولى" required />
                    </div>
                    <div class="form-group">
                      <label>تاريخ الفتح (اختياري)</label>
                      <input type="datetime-local" id="examScheduledStart" class="form-control" />
                    </div>
                    <div class="form-group">
                      <label>تاريخ الإغلاق (اختياري — يحجب الإجابات حتى انتهائه)</label>
                      <input type="datetime-local" id="examScheduledEnd" class="form-control" />
                    </div>
                  </div>

                  <div id="adminMcqQuestionsList" style="margin-top:16px;">
                    ${this.renderAdminQuestionInputRow(1)}
                  </div>

                  <div class="card-meta-row" style="margin-top:14px; margin-bottom:0;">
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                      <button type="button" class="btn btn-outline-gold" data-click="addMoreQuestionRow" data-container="adminMcqQuestionsList">${this.icon("plus", 15)} إضافة سؤال آخر</button>
                      <button type="button" class="btn btn-emerald" data-click="openBulkImportQuestionsModal" data-container="adminMcqQuestionsList">${this.icon("download", 14)} استيراد أسئلة دفعة واحدة</button>
                    </div>
                    <button type="submit" class="btn btn-gold">${this.icon("check-circle", 14)} حفظ ونشر الاختبار</button>
                  </div>
                </form>
              `}
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'retakes') {
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon("alert-triangle", 15)} كشف الطلاب الراسبين في الامتحانات (50% فأقل)</h3>
                  <p style="font-size:0.82rem; color:var(--text-secondary);">حدد لهم موعد امتحان الإعادة (الملحق) ليتمكنوا من فتح الحصة التالية</p>
                </div>
              </div>

              ${d.failed_submissions.length === 0 ? `
                <div style="text-align:center; padding:32px; color:var(--success-text); display:flex; align-items:center; justify-content:center; gap:8px;">${this.icon('check-circle', 20)} <span>لا يوجد طلاب راسبون حالياً.</span></div>
              ` : `
                <div class="table-responsive">
                  <table class="matn-table">
                    <thead>
                      <tr>
                        <th>اسم الطالب</th>
                        <th>رقم الهاتف</th>
                        <th>المحاضرة</th>
                        <th>الدرجة</th>
                        <th>نقاط الضعف</th>
                        <th>إجراء الأدمن</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${d.failed_submissions.map((f) => `
                        <tr>
                          <td style="font-weight:800; color:var(--gold-300);">${this.esc(f.full_name)}</td>
                          <td>${this.esc(f.phone)}</td>
                          <td>${this.esc(f.lesson_title)}</td>
                          <td><span class="badge badge-danger">${Number(f.score)} / ${Number(f.total_points)} (${Number(f.percentage)}%)</span></td>
                          <td>${f.weak_topics.map((t) => `<span class="badge badge-danger" style="margin:2px;">${this.esc(t)}</span>`).join('')}</td>
                          <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                              <button class="btn btn-gold btn-sm" data-click="openScheduleRetakeModal" data-id="${Number(f.lesson_id)}">${this.icon("calendar", 15)} جدولة امتحان ملحق</button>
                              <button class="btn btn-whatsapp btn-sm" data-click="openParentReportModal" data-id="${Number(f.user_id)}">${this.icon("smartphone", 15)} إبلاغ ولي الأمر</button>
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

      if (this.adminTab === 'students') {
        const hasPrev = this.adminStudentsOffset > 0;
        const hasNext = (this.adminStudentsOffset + d.students.length) < totalStudents;
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header" style="gap:10px;">
                <div>
                  <h3 class="section-title">${this.icon("users", 15)} الطلاب المسجلون والتحكم في الحسابات والأجهزة (${totalStudents})</h3>
                  <p style="font-size:0.82rem; color:var(--text-secondary);">عرض ${d.students.length} طالباً من إجمالي ${totalStudents} نتيجة مطابقة</p>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  <button type="button" class="btn btn-whatsapp btn-sm" data-click="runWeeklyParentReports">${this.icon("smartphone", 15)} إرسال تقارير لجميع أولياء الأمور</button>
                  <input type="text" id="adminStudentsSearchInput" class="form-control" style="width:210px; padding:7px 12px;" placeholder="بحث بالاسم أو الهاتف..." value="${this.esc(this.adminStudentsQuery || '')}" data-input="searchAdminStudents" />
                  <select class="form-control" style="width:auto; padding:7px 12px;" data-change="onAdminStudentsFilterChange">
                    <option value="all" ${this.adminStudentsFilter === 'all' ? 'selected' : ''}>الكل</option>
                    <option value="active" ${this.adminStudentsFilter === 'active' ? 'selected' : ''}>اشتراك نشط</option>
                    <option value="expiring_soon" ${this.adminStudentsFilter === 'expiring_soon' ? 'selected' : ''}>ينتهي خلال ٣ أيام (${Number(d.expiring_soon_count || 0)})</option>
                    <option value="expired" ${this.adminStudentsFilter === 'expired' ? 'selected' : ''}>غير مشترك / منتهٍ</option>
                    <option value="locked" ${this.adminStudentsFilter === 'locked' ? 'selected' : ''}>موقوف إدارياً</option>
                    <option value="device_reset" ${this.adminStudentsFilter === 'device_reset' ? 'selected' : ''}>طلب تغيير جهاز</option>
                  </select>
                  ${hasPrev ? `<button class="btn btn-outline-gold btn-sm" data-click="pageStudents" data-arg="${Math.max(0, this.adminStudentsOffset - this.adminPageSize)}">${this.icon('chevron-right', 14)} <span>السابق</span></button>` : ''}
                  ${hasNext ? `<button class="btn btn-outline-gold btn-sm" data-click="pageStudents" data-arg="${this.adminStudentsOffset + this.adminPageSize}"><span>التالي</span> ${this.icon('chevron-left', 14)}</button>` : ''}
                </div>
              </div>

              <div class="table-responsive">
                <table class="matn-table">
                  <thead>
                    <tr>
                      <th>اسم الطالب رباعياً</th>
                      <th>أرقام التواصل</th>
                      <th>الصف والمشاهدة</th>
                      <th>الحالة والواتساب</th>
                      <th>الاشتراك</th>
                      <th>الجهاز المربوط</th>
                      <th>إجراءات سريعة</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${d.students.length === 0 ? `
                      <tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-secondary);">لا توجد نتائج مطابقة للبحث أو الفلتر المختار.</td></tr>
                    ` : d.students.map((st) => {
                      const exp = st.subscription_expires_at ? new Date(st.subscription_expires_at) : null;
                      const active = exp && exp > new Date();
                      const daysLeft = active ? Math.ceil((exp.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0;
                      return `
                        <tr style="${st.is_locked ? 'opacity:0.68;' : ''}">
                          <td style="font-weight:800; color:var(--gold-300);">
                            ${this.esc(st.full_name)}
                            ${st.is_locked ? `<div><span class="badge badge-danger">${this.icon('ban', 12)} <span>موقوف إدارياً</span></span></div>` : ''}
                          </td>
                          <td>
                            <div style="display:flex; align-items:center; gap:5px;">${this.icon('smartphone', 13)} <span dir="ltr">${this.esc(st.phone)}</span></div>
                            <div style="font-size:0.75rem; color:var(--text-secondary);">ولي الأمر: <span dir="ltr">${this.esc(st.parent_phone || '-')}</span></div>
                          </td>
                          <td>
                            <div>${this.esc(GRADES_META[st.grade] || st.grade)}</div>
                            <span class="badge badge-gold">${this.esc(BRANCHES_META[st.branch] || st.branch)}</span>
                            <span class="badge badge-success">${this.icon('video', 14)} ${Number(st.avg_watch_percent || 0)}%</span>
                          </td>
                          <td>
                            ${st.is_whatsapp_verified
                              ? `<span class="badge badge-success">${this.icon('check-circle', 13)} <span>مفعل</span></span>`
                              : `<div>
                                   <span class="badge badge-danger">${this.icon('hourglass', 12)} <span>بانتظار التفعيل</span></span>
                                   <button class="btn btn-sm btn-emerald" style="margin-top:4px;" data-click="verifyStudentWhatsappManually" data-id="${Number(st.id)}">تفعيل يدوي</button>
                                 </div>`}
                          </td>
                          <td>
                            ${active
                              ? `<span class="badge ${daysLeft <= 3 ? 'badge-warning' : 'badge-success'}">${daysLeft <= 3 ? `${this.icon('hourglass', 12)} ${daysLeft} يوم` : 'سارٍ'} (${this.esc(exp.toLocaleDateString('ar-EG'))})</span>`
                              : `<span class="badge badge-danger">غير مشترك</span>`}
                          </td>
                          <td>
                            ${st.device_id
                              ? `<span class="badge badge-gold">${this.icon('lock', 13)} ${this.esc(st.device_name || 'جهاز الطالب')}</span>`
                              : `<span style="color:var(--text-secondary); font-size:0.78rem;">مفتوح لأول دخول</span>`}
                            ${st.device_reset_requested ? `<div style="margin-top:4px;"><span class="badge badge-danger">${this.icon('bell', 13)} طلب إعادة تعيين جهاز</span></div>` : ''}
                          </td>
                          <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                              <button class="btn btn-whatsapp btn-sm" data-click="openParentReportModal" data-id="${Number(st.id)}">${this.icon('smartphone', 14)} <span>ولي الأمر</span></button>
                              <button class="btn btn-outline-gold btn-sm" data-click="resetStudentDevice" data-id="${Number(st.id)}">${this.icon('unlock', 14)} <span>مسح الجهاز</span></button>
                              <button class="btn btn-outline-gold btn-sm" data-click="openResetStudentPasswordModal" data-id="${Number(st.id)}" data-name="${this.esc(st.full_name)}">${this.icon('key', 14)} <span>باسورد</span></button>
                              <button class="btn btn-emerald btn-sm" data-click="grantStudentMonth" data-id="${Number(st.id)}">+30 يوم</button>
                              ${st.is_locked
                                ? `<button class="btn btn-emerald btn-sm" data-click="unlockStudentAccount" data-id="${Number(st.id)}">${this.icon('unlock', 14)} <span>تفعيل</span></button>`
                                : `<button class="btn btn-danger btn-sm" data-click="lockStudentAccount" data-id="${Number(st.id)}">${this.icon('ban', 14)} <span>إيقاف</span></button>`}
                              <button class="btn btn-danger btn-sm" data-click="deleteStudentAccount" data-id="${Number(st.id)}" aria-label="حذف">${this.icon('trash', 14)}</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'vouchers') {
        const hasPrev = this.adminVouchersOffset > 0;
        const hasNext = (this.adminVouchersOffset + d.vouchers.length) < totalVouchers;
        return `
          <div class="fade-in">
            <div class="grid-3 no-print" style="margin-bottom:16px;">
              <div class="stat-box">
                <span class="stat-label">إيراد هذا الشهر</span>
                <span class="stat-value" style="color:var(--success-text);">${Number(rev.month_revenue_egp || 0).toLocaleString('ar-EG')} ج.م</span>
                <span style="font-size:0.74rem; color:var(--text-secondary);">كروت مفعّلة هذا الشهر: ${Number(rev.month_used_vouchers || 0)}</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">إجمالي إيراد الأكواد المفعّلة</span>
                <span class="stat-value">${Number(rev.total_revenue_egp || 0).toLocaleString('ar-EG')} ج.م</span>
                <span style="font-size:0.74rem; color:var(--text-secondary);">إجمالي المفعّلة: ${Number(rev.total_used_vouchers || 0)} كود</span>
              </div>
              <div class="stat-box">
                <span class="stat-label">الكروت المتاحة غير المستخدمة</span>
                <span class="stat-value">${unusedVouchers}</span>
              </div>
            </div>

            <div class="section-card no-print" style="border-color:rgba(16,185,129,0.45); background:linear-gradient(135deg, rgba(16,185,129,0.08), rgba(212,178,106,0.06));">
              <div class="section-header" style="margin-bottom:10px;">
                <div>
                  <h3 class="section-title" style="color:var(--success-text);">${this.icon("message-circle", 16)} الرد السريع على رسائل طلب الكود (تأكيد التحويل وإرسال الكود عبر واتساب)</h3>
                  <p style="font-size:0.8rem; color:var(--text-secondary); margin:4px 0 0;">
                    الصق هنا رسالة الطالب اللي طلب فيها الكود بعد ما تتأكد من وصول الفلوس — المنصة هتطلع اسمه ورقمه وصفه وتكتبلك رسالة ترحيبية جاهزة بكود التفعيل، وتضغط زر واحد يحولك لواتساب الطالب فوراً.
                  </p>
                </div>
                ${this._quickVoucherResult ? `<button type="button" class="btn btn-outline-gold btn-sm" data-click="resetQuickVoucherReply">رسالة طالب جديد</button>` : ''}
              </div>

              <form data-submit="handleQuickVoucherReplySubmit">
                <div class="form-group">
                  <label>١) الصق رسالة الطالب هنا (من واتساب):</label>
                  <textarea id="quickReplyRawMessage" class="form-control" rows="3" placeholder="مثال: السلام عليكم ورحمة الله وبركاته&#10;أنا الطالب: أحمد محمود محمد&#10;الصف: الصف الثالث الثانوي&#10;عاوز كود التفعيل - رقم هاتف الحساب: 01012345678" data-input="parseQuickVoucherRequest">${this.esc(this._quickVoucherRaw || '')}</textarea>
                </div>

                <div class="grid-3" style="gap:10px; margin-bottom:10px;">
                  <div class="form-group" style="margin:0;">
                    <label>اسم الطالب في الترحيب *</label>
                    <input type="text" id="quickReplyName" class="form-control" placeholder="مثال: أحمد محمود" value="${this.esc(this._quickVoucherName || '')}" data-input="onQuickVoucherFieldChange" required />
                  </div>
                  <div class="form-group" style="margin:0;">
                    <label>رقم واتساب الطالب (١١ رقماً) *</label>
                    <input type="tel" id="quickReplyPhone" class="form-control" placeholder="010xxxxxxxx" value="${this.esc(this._quickVoucherPhone || '')}" data-input="onQuickVoucherFieldChange" required />
                  </div>
                  <div class="form-group" style="margin:0;">
                    <label>نطاق الصف الدراسي</label>
                    <select id="quickReplyGradeScope" class="form-control" data-change="onQuickVoucherFieldChange">
                      ${this.renderGradeOptions(this._quickVoucherGrade || 'all', 'جميع الصفوف (تلقائي)')}
                    </select>
                  </div>
                </div>

                <div class="form-row-2" style="margin-bottom:10px; align-items:end;">
                  <div class="form-group" style="margin:0;">
                    <label>المادة</label>
                    <select id="quickReplySubjectScope" class="form-control" data-change="onQuickVoucherFieldChange">
                      <option value="all" ${(this._quickVoucherSubject || 'all') === 'all' ? 'selected' : ''}>الباقة الشاملة (جميع المواد)</option>
                      <option value="fiqh" ${this._quickVoucherSubject === 'fiqh' ? 'selected' : ''}>الفقه فقط</option>
                      <option value="tafseer" ${this._quickVoucherSubject === 'tafseer' ? 'selected' : ''}>التفسير فقط</option>
                      <option value="hadith" ${this._quickVoucherSubject === 'hadith' ? 'selected' : ''}>الحديث فقط</option>
                      <option value="tawheed" ${this._quickVoucherSubject === 'tawheed' ? 'selected' : ''}>التوحيد فقط</option>
                      <option value="mawareeth" ${this._quickVoucherSubject === 'mawareeth' ? 'selected' : ''}>المواريث فقط (الثالث الثانوي)</option>
                      <option value="seerah" ${this._quickVoucherSubject === 'seerah' ? 'selected' : ''}>السيرة فقط</option>
                      <option value="tajweed" ${this._quickVoucherSubject === 'tajweed' ? 'selected' : ''}>التجويد فقط</option>
                    </select>
                  </div>
                  <label style="display:flex; align-items:center; gap:8px; background:rgba(16,185,129,0.08); border:1px solid var(--border-gold); border-radius:10px; padding:10px 12px; cursor:pointer; font-size:0.82rem; margin:0;">
                    <input type="checkbox" id="quickReplyRestrictPhone" ${this._quickVoucherRestrict ? 'checked' : ''} />
                    <span>${this.icon("lock", 14)} قفل الكود على رقم الطالب ده فقط</span>
                  </label>
                </div>

                <div class="form-group">
                  <div class="card-meta-row" style="margin-bottom:4px;">
                    <label style="margin:0;">٢) رسالة الترحيب الجاهزة للطالب (تقدر تعدّل فيها براحتك — رمز <code>{CODE}</code> هيتبدّل بالكود الحقيقي):</label>
                    <button type="button" class="btn btn-outline-gold btn-sm" style="padding:4px 10px; font-size:0.75rem;" data-click="regenerateQuickGreeting">${this.icon('refresh', 13)} <span>إعادة صياغة الترحيب</span></button>
                  </div>
                  <textarea id="quickReplyGreetingText" class="form-control" rows="5" data-input="markQuickGreetingCustom">${this.esc(this._quickVoucherGreeting || this.buildQuickVoucherGreetingTemplate('', 'all', 'all'))}</textarea>
                </div>

                <button type="submit" class="btn btn-whatsapp" style="width:100%; padding:13px; font-size:0.98rem; font-weight:800;">
                  ${this.icon('message-circle', 17)} <span>تجهيز كود التفعيل وفتح واتساب الطالب بالرسالة الجاهزة</span>
                </button>
              </form>

              ${this._quickVoucherResult ? `
                <div id="quickReplyReadyBox" style="margin-top:14px; background:rgba(16,185,129,0.12); border:1.5px solid #10b981; border-radius:14px; padding:14px;">
                  <div style="font-weight:900; color:var(--success-text); font-size:0.95rem; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                    ${this.icon('check-circle', 16)} <span>تم تجهيز وحجز الكود للطالب (${this.esc(this._quickVoucherResult.recipient_name || '')}):</span>
                  </div>
                  <div class="scratch-code-box" style="margin:6px 0 10px;">${this.esc(this._quickVoucherResult.code)}</div>
                  <pre style="white-space:pre-wrap; font-family:inherit; background:var(--bg-main); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px; font-size:0.84rem; margin:0 0 12px;">${this.esc(this._quickVoucherResult.whatsapp_message)}</pre>
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <a href="${this.esc(this.safeHttpsUrl(this._quickVoucherResult.whatsapp_url) || '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="flex:1; min-width:220px; text-align:center;">
                      ${this.icon('send', 16)} <span>التحويل مباشرة لواتساب الطالب بالرسالة</span>
                    </a>
                    <button type="button" class="btn btn-outline-gold" data-click="copyText" data-copy="${this.esc(this._quickVoucherResult.whatsapp_message)}" data-label="رسالة التفعيل">
                      ${this.icon('clipboard', 15)} <span>نسخ الرسالة</span>
                    </button>
                  </div>
                </div>
              ` : ''}
            </div>

            <div class="section-card no-print">
              <div class="section-header">
                <h3 class="section-title">${this.icon("ticket", 15)} توليد دفعة أكواد شحن جديدة (30 يوماً من تاريخ الاستخدام)</h3>
              </div>
              <form data-submit="handleGenerateVouchers" class="grid-3" style="align-items:end;">
                <div class="form-group" style="margin:0;">
                  <label>اسم الدفعة</label>
                  <input type="text" id="vBatchName" class="form-control" value="دفعة الاشتراك الشهري" required />
                </div>
                <div class="form-group" style="margin:0;">
                  <label>العدد</label>
                  <input type="number" id="vCount" class="form-control" value="6" min="1" max="200" required />
                </div>
                <div class="form-group" style="margin:0;">
                  <label>سعر الكود (ج.م)</label>
                  <input type="number" id="vPriceEgp" class="form-control" value="150" min="0" required />
                </div>
                <div class="form-group" style="margin:0;">
                  <label>نطاق الصف الدراسي</label>
                  <select id="vGradeScope" class="form-control">
                    ${this.renderGradeOptions('all', 'جميع الصفوف (إعدادي وثانوي)')}
                  </select>
                </div>
                <div class="form-group" style="margin:0;">
                  <label>نطاق المواد</label>
                  <select id="vSubjectScope" class="form-control">
                    <option value="all">الباقة الشاملة (جميع المواد)</option>
                    <option value="fiqh">الفقه فقط</option>
                    <option value="tafseer">التفسير فقط</option>
                    <option value="hadith">الحديث فقط</option>
                    <option value="tawheed">التوحيد فقط</option>
                    <option value="mawareeth">المواريث فقط (الثالث الثانوي)</option>
                    <option value="seerah">السيرة فقط</option>
                    <option value="tajweed">التجويد فقط</option>
                  </select>
                </div>
                <button type="submit" class="btn btn-gold" style="height:44px;">${this.icon('zap', 15)} <span>توليد الكروت</span></button>
              </form>
            </div>

            <div class="section-card">
              <div class="section-header no-print" style="gap:10px;">
                <h3 class="section-title">${this.icon('file-text', 15)} <span>كروت الشحن (${totalVouchers})</span></h3>
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                  <input type="text" id="adminVouchersSearchInput" class="form-control" style="width:190px; padding:6px 10px;" placeholder="كود، دفعة، أو طالب..." value="${this.esc(this.adminVouchersQuery || '')}" data-input="searchAdminVouchers" />
                  <select class="form-control" style="width:auto; padding:6px 10px;" data-change="onAdminVouchersFilterChange">
                    <option value="all" ${this.adminVouchersFilter === 'all' ? 'selected' : ''}>الكل</option>
                    <option value="unused" ${this.adminVouchersFilter === 'unused' ? 'selected' : ''}>متاح لم يُرسل</option>
                    <option value="reserved" ${this.adminVouchersFilter === 'reserved' ? 'selected' : ''}>محجوز / مُرسَل</option>
                    <option value="used" ${this.adminVouchersFilter === 'used' ? 'selected' : ''}>مستخدَم</option>
                  </select>
                  ${hasPrev ? `<button class="btn btn-outline-gold btn-sm" data-click="pageVouchers" data-arg="${Math.max(0, this.adminVouchersOffset - this.adminPageSize)}">${this.icon('chevron-right', 14)} <span>السابق</span></button>` : ''}
                  ${hasNext ? `<button class="btn btn-outline-gold btn-sm" data-click="pageVouchers" data-arg="${this.adminVouchersOffset + this.adminPageSize}"><span>التالي</span> ${this.icon('chevron-left', 14)}</button>` : ''}
                  <button class="btn btn-gold btn-sm" data-click="printVouchers">${this.icon("file-text", 15)} طباعة الكروت</button>
                </div>
              </div>

              <div class="voucher-cards-grid">
                ${d.vouchers.map((v) => {
                  const isReserved = !v.is_used && Boolean(v.assigned_to_phone);
                  return `
                    <div class="scratch-card" style="${isReserved ? 'border-color:var(--gold-400);' : ''}">
                      <div class="card-meta-row" style="margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                          <img src="/assets/logo.png" style="width:34px; height:34px; border-radius:50%; border:1.5px solid var(--gold-400);" />
                          <div>
                            <div style="font-weight:900; color:var(--gold-400); font-size:0.86rem;">منصة مَتْن • MATN</div>
                            <div style="font-size:0.7rem; color:var(--text-secondary);">${this.esc(v.batch_name || '')}</div>
                          </div>
                        </div>
                        <span class="badge ${v.is_used ? 'badge-danger' : (isReserved ? 'badge-warning' : 'badge-success')}">
                          ${v.is_used ? 'مستخدَم' : (isReserved ? `${this.icon('send', 12)} محجوز/مُرسَل` : `${Number(v.duration_days)} يوماً`)}
                        </span>
                      </div>
                      <div class="scratch-code-box">${this.esc(v.code)}</div>
                      <div class="card-meta-row" style="font-size:0.72rem; color:var(--text-secondary); margin-bottom:6px;">
                        <span>${this.esc(v.subject_scope === 'all' ? 'كل المواد' : (SUBJECTS_META[v.subject_scope]?.name || v.subject_scope))}</span>
                        <span>${this.esc(v.grade_scope === 'all' ? 'كل الصفوف' : (GRADES_META[v.grade_scope] || v.grade_scope))}</span>
                      </div>
                      ${v.is_used ? `
                        <div style="font-size:0.72rem; color:var(--danger-text);">استخدمه: <b>${this.esc(v.used_by_name || v.used_by_phone || 'طالب')}</b></div>
                      ` : `
                        ${isReserved ? `
                          <div class="no-print" style="background:rgba(212,178,106,0.1); border:1px solid rgba(212,178,106,0.35); border-radius:8px; padding:6px 8px; font-size:0.72rem; margin-bottom:6px;">
                            <div style="display:flex; align-items:center; gap:5px;">${this.icon('send', 12)} <span>أُرسل إلى: <b>${this.esc(v.assigned_to_name)}</b> (<span dir="ltr">${this.esc(v.assigned_to_phone)}</span>)</span></div>
                            ${v.restrict_to_phone ? `<div style="color:var(--success-text); font-weight:700;">${this.icon('lock', 13)} مقفول على هذا الرقم فقط</div>` : ''}
                          </div>
                        ` : ''}
                        <div class="no-print" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
                          <button type="button" class="btn btn-whatsapp btn-sm" style="flex:1;" data-click="openSendVoucherModal" data-id="${Number(v.id)}">
                            ${this.icon('send', 13)} <span>${isReserved ? 'إعادة الإرسال' : 'إرسال لطالب عبر واتساب'}</span>
                          </button>
                          ${isReserved ? `<button type="button" class="btn btn-outline-gold btn-sm" data-click="releaseVoucherAssignment" data-id="${Number(v.id)}">${this.icon('undo', 13)} <span>فك الحجز</span></button>` : ''}
                        </div>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'weekly_reports') {
        const wr = d.weekly_reports || { week_key: '', items: [], auto_friday_reports_enabled: true };
        const items = wr.items || [];
        const sentCount = items.filter((i) => i.status === 'sent').length;
        const pendingItems = items.filter((i) => i.status === 'manual_ready' || i.status === 'pending' || i.status === 'failed');
        const nextItem = pendingItems[0] || null;
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header" style="gap:10px;">
                <div>
                  <h3 class="section-title">${this.icon("calendar", 15)} متابعة أولياء الأمور الأسبوعية (كل جمعة الساعة ٣ عصراً بالتتابع)</h3>
                  <p style="font-size:0.82rem; color:var(--text-secondary);">
                    الأسبوع المسجل: <b>${this.esc(wr.week_key || wr.current_friday_key || '')}</b> •
                    الجدولة التلقائية كل جمعة ٣ عصراً: <b>${wr.auto_friday_reports_enabled ? 'مفعلة' : 'متوقفة مؤقتاً'}</b>
                  </p>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                  <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; color:var(--text-secondary); cursor:pointer;">
                    <input type="checkbox" id="weeklyIncludeAllVerified" />
                    <span>شامل جميع الطلاب المسجلين</span>
                  </label>
                  <button type="button" class="btn btn-whatsapp btn-sm" data-click="runWeeklyParentReports">${this.icon('zap', 15)} <span>إرسال التقارير إلى جميع أولياء الأمور الآن</span></button>
                  ${items.length > 0 ? `<button type="button" class="btn btn-outline-gold btn-sm" data-click="copyAllWeeklyReports">${this.icon('file-text', 14)} <span>نسخ كل الأرقام والرسائل</span></button>` : ''}
                </div>
              </div>

              <div style="background:${d.whatsapp_gateway_configured ? 'rgba(16,185,129,0.1)' : 'rgba(212,178,106,0.1)'}; border:1px solid ${d.whatsapp_gateway_configured ? '#10b981' : 'var(--border-gold)'}; border-radius:12px; padding:12px 14px; margin-bottom:16px; font-size:0.83rem;">
                ${d.whatsapp_gateway_configured
                  ? `${this.icon('check-circle', 14)} <b>بوابة الواتساب الآلية مربوطة في السيرفر:</b> تقوم المنصة كل يوم جمعة الساعة 3:00 عصراً (بتوقيت القاهرة) بإرسال التقارير إلى أرقام أولياء الأمور <b>تلقائياً طالباً تلو الآخر بالتتابع</b>.`
                  : `${this.icon('settings', 15)} <b>ملاحظة هامة عن الإرسال الآلي:</b> المنصة مُبرمجة بالفعل لجدولة وإرسال تقارير أولياء الأمور تلقائياً كل جمعة 3:00 عصراً طالباً تلو الآخر، وبدون بوابة واتساب آلية تجهز المنصة قائمة الطلاب بالأسفل لتضغط على <b>«إرسال التالي الآن»</b> طالباً تلو الآخر بنقرة واحدة!`}
              </div>

              <div class="grid-3" style="margin-bottom:16px;">
                <div class="stat-box"><span class="stat-label">إجمالي الطلاب في القائمة</span><span class="stat-value">${items.length}</span></div>
                <div class="stat-box"><span class="stat-label">تم إرساله بالفعل</span><span class="stat-value" style="color:var(--success-text);">${sentCount}</span></div>
                <div class="stat-box"><span class="stat-label">متبقٍ في الدور (طالب تلو الآخر)</span><span class="stat-value" style="color:var(--gold-400);">${pendingItems.length}</span></div>
              </div>

              ${nextItem ? `
                <div style="background:linear-gradient(135deg, rgba(37,211,102,0.12), var(--bg-card)); border:1.5px solid #25D366; border-radius:14px; padding:14px; margin-bottom:16px;">
                  <div class="card-meta-row" style="margin-bottom:8px;">
                    <div>
                      <span class="badge badge-success">${this.icon('skip-forward', 12)} <span>الطالب التالي في الدور</span></span>
                      <h4 style="color:var(--text-primary); margin-top:4px;">${this.esc(nextItem.student_name)} — ولي الأمر: <span dir="ltr">${this.esc(nextItem.parent_phone)}</span></h4>
                    </div>
                    <button type="button" class="btn btn-whatsapp" data-click="sendNextSequentialWeeklyReport" data-id="${Number(nextItem.id)}">${this.icon('smartphone', 15)} <span>إرسال الآن والانتقال للطالب التالي</span></button>
                  </div>
                  <pre style="white-space:pre-wrap; font-family:inherit; font-size:0.8rem; color:var(--text-secondary); background:rgba(0,0,0,0.22); padding:10px; border-radius:8px;">${this.esc(nextItem.report_text)}</pre>
                </div>
              ` : ''}

              ${items.length === 0 ? `<div style="text-align:center; padding:28px; color:var(--text-secondary);">لا توجد تقارير مجهزة لهذا الأسبوع بعد.</div>` : `
                <div class="table-responsive">
                  <table class="matn-table">
                    <thead><tr><th>#</th><th>الطالب</th><th>رقم ولي الأمر</th><th>الحالة</th><th>التفاصيل / الإجراء</th></tr></thead>
                    <tbody>
                      ${items.map((item, idx) => `
                        <tr>
                          <td>${idx + 1}</td>
                          <td style="font-weight:800; color:var(--gold-300);">${this.esc(item.student_name)}</td>
                          <td dir="ltr">${this.esc(item.parent_phone)}</td>
                          <td><span class="badge ${item.status === 'sent' ? 'badge-success' : (item.status === 'failed' ? 'badge-danger' : 'badge-gold')}">${item.status === 'sent' ? 'تم الإرسال' : (item.status === 'failed' ? 'تعذر' : `${this.icon('send', 12)} جاهز في الدور`)}</span></td>
                          <td>${item.status === 'sent' ? `<span style="font-size:0.76rem; color:var(--text-secondary);">${this.esc(item.sent_at ? new Date(item.sent_at).toLocaleString('ar-EG') : '')}</span>` : `<button type="button" class="btn btn-whatsapp btn-sm" data-click="sendNextSequentialWeeklyReport" data-id="${Number(item.id)}">${this.icon('smartphone', 15)} <span>إرسال عبر واتساب</span></button>`}</td>
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

      if (this.adminTab === 'questions') {
        const qsList = d.lesson_questions || [];
        return `
          <div class="fade-in">
            <div class="section-card">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon('help-circle', 16)} <span>أسئلة الطلاب لفضيلة الأستاذ (${qsList.length})</span></h3>
                  <p style="font-size:0.82rem; color:var(--text-secondary);">أجب على أسئلة الطلاب واختر نشر الإجابة ليراها طلاب المحاضرة أو إخفاءها</p>
                </div>
              </div>
              ${qsList.length === 0 ? `<div style="text-align:center; padding:32px; color:var(--text-secondary);">لا توجد أسئلة مرسلة من الطلاب حتى الآن.</div>` : `
                <div style="display:flex; flex-direction:column; gap:12px;">
                  ${qsList.map((q) => `
                    <div class="question-box" style="margin-bottom:0; border-color:${q.admin_answer ? 'rgba(16,185,129,0.35)' : '#f59e0b'};">
                      <div class="card-meta-row">
                        <div>
                          <span class="badge badge-gold">${this.esc(q.lesson_title)}</span>
                          <span class="badge ${q.admin_answer ? (q.is_published ? 'badge-success' : 'badge-gold') : 'badge-danger'}">
                            ${q.admin_answer ? (q.is_published ? 'مُجاب ومنشور' : 'مُجاب (غير منشور)') : `${this.icon('hourglass', 12)} بانتظار الرد`}
                          </span>
                        </div>
                        <button type="button" class="btn btn-danger btn-sm" data-click="deleteLessonQuestion" data-id="${Number(q.id)}">${this.icon('trash', 14)} <span>حذف</span></button>
                      </div>
                      <div style="font-size:0.8rem; color:var(--gold-300); margin-bottom:4px; display:flex; align-items:center; gap:5px;">${this.icon('graduation-cap', 14)} <span>الطالب: <b>${this.esc(q.student_name)}</b></span></div>
                      <div style="font-size:0.92rem; color:var(--text-primary); margin-bottom:10px;">${this.esc(q.question_text)}</div>
                      <form data-submit="handleAnswerLessonQuestion" data-id="${Number(q.id)}">
                        <div class="form-group" style="margin-bottom:8px;">
                          <textarea name="admin_answer" class="form-control" rows="2" placeholder="اكتب رد فضيلة الأستاذ هنا..." required>${this.esc(q.admin_answer || '')}</textarea>
                        </div>
                        <div class="card-meta-row" style="margin-bottom:0;">
                          <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                            <input type="checkbox" name="is_published" ${(!q.admin_answer || q.is_published) ? 'checked' : ''} />
                            <span>نشر الإجابة لباقي طلاب المحاضرة</span>
                          </label>
                          <button type="submit" class="btn btn-gold btn-sm">${this.icon("save", 15)} حفظ الرد</button>
                        </div>
                      </form>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          </div>
        `;
      }

      if (this.adminTab === 'settings') {
        const ps = d.platform_settings || {};
        return `
          <div class="fade-in">
            <div class="section-card" style="max-width:680px; margin:0 auto;">
              <div class="section-header">
                <div>
                  <h3 class="section-title">${this.icon("settings", 15)} إعدادات المنصة والتواصل العام</h3>
                  <p style="font-size:0.8rem; color:var(--text-secondary);">تظهر هذه البيانات في الصفحة الرئيسية وروابط الدعم (يُنصح أن يختلف رقم الدعم عن رقم دخول الأدمن)</p>
                </div>
              </div>

              <form data-submit="handleSaveSettings">
                <div class="form-group"><label>اسم المنصة</label><input type="text" id="setPlatformName" class="form-control" maxlength="120" value="${this.esc(ps.platform_name || '')}" required /></div>
                <div class="form-group"><label>اسم المعلم / الشيخ</label><input type="text" id="setTeacherName" class="form-control" maxlength="100" value="${this.esc(ps.teacher_name || '')}" required /></div>
                <div class="form-group"><label>رقم واتساب الدعم الفني للطلاب (يظهر للعامة)</label><input type="tel" id="setSupportWhatsapp" class="form-control" maxlength="20" value="${this.esc(ps.support_whatsapp || '')}" required /></div>
                <div class="grid-2">
                  <div class="form-group"><label>رقم فودافون كاش للتحويل (اختياري)</label><input type="tel" id="setVodafoneCash" class="form-control" maxlength="20" placeholder="010xxxxxxxx" value="${this.esc(ps.vodafone_cash_number || '')}" /></div>
                  <div class="form-group"><label>حساب إنستا باي / InstaPay (اختياري)</label><input type="text" id="setInstapayHandle" class="form-control" maxlength="100" placeholder="username@instapay" value="${this.esc(ps.instapay_handle || '')}" /></div>
                </div>
                <div class="form-group"><label>تاريخ بداية امتحانات الأزهر الشريف (اختياري — لعرض العد التنازلي للطلاب)</label><input type="date" id="setAzharExamDate" class="form-control" value="${this.esc(ps.azhar_exam_date || '')}" /></div>
                <div class="form-group"><label>الشريط الترحيبي / الإعلاني العلوي</label><textarea id="setAnnouncementBanner" class="form-control" rows="3" maxlength="300" required>${this.esc(ps.announcement_banner || '')}</textarea></div>
                <div style="display:grid; gap:8px; margin-bottom:14px;">
                  <label style="display:flex; align-items:center; gap:8px; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px; cursor:pointer; font-size:0.84rem;">
                    <input type="checkbox" id="setAutoFridayReports" ${ps.auto_friday_reports_enabled !== '0' ? 'checked' : ''} />
                    <span>${this.icon("calendar", 15)} تفعيل جدولة وإرسال تقارير أولياء الأمور بالتتابع تلقائياً كل يوم جمعة الساعة ٣ عصراً</span>
                  </label>
                  <label style="display:flex; align-items:center; gap:8px; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 12px; cursor:pointer; font-size:0.84rem;">
                    <input type="checkbox" id="setHonorRollEnabled" ${ps.honor_roll_enabled !== '0' ? 'checked' : ''} />
                    <span>${this.icon("trophy", 15)} إظهار «لوحة الشرف / أوائل الصف» في بوابة الطلاب</span>
                  </label>
                </div>
                <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon("save", 15)} حفظ إعدادات المنصة</button>
              </form>
            </div>
          </div>
        `;
      }

      const sharedDevices = d.multi_account_devices || [];
      return `
        <div class="fade-in">
          <div class="section-card">
            <div class="section-header">
              <div>
                <h3 class="section-title">${this.icon("smartphone", 15)} حالة بوابة الواتساب (تُدار عبر متغيرات البيئة .env)</h3>
                <p style="font-size:0.82rem; color:var(--text-secondary);">
                  حالة الربط الخادمي: ${d.whatsapp_gateway_configured ? '<span class="badge badge-success">متصلة عبر متغيرات البيئة</span>' : '<span class="badge badge-gold">غير مفعلة في .env (وضع التسجيل الآمن)</span>'}
                </p>
              </div>
            </div>
          </div>

          ${sharedDevices.length > 0 ? `
            <div class="section-card" style="border-color:rgba(244,63,94,0.45);">
              <div class="section-header"><h3 class="section-title" style="color:var(--danger-text);">${this.icon("alert-triangle", 15)} تنبيه: أجهزة مشتركة بين أكثر من حساب طالب (${sharedDevices.length})</h3></div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                ${sharedDevices.map((m) => `
                  <div style="background:var(--bg-card); border:1px solid rgba(244,63,94,0.3); padding:10px 12px; border-radius:10px;">
                    <div style="font-weight:800; color:var(--gold-400); font-size:0.84rem;">الجهاز: ${this.esc(m.device_id)} (${Number(m.account_count)} حسابات)</div>
                    <div style="font-size:0.78rem; color:var(--text-secondary);">${this.esc(m.accounts_list)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div class="grid-2">
            <div class="section-card">
              <div class="section-header"><h3 class="section-title">${this.icon("file-text", 14)} سجل التدقيق للعمليات الحساسة (Audit Logs: ${(d.audit_logs || []).length})</h3></div>
              <div style="display:flex; flex-direction:column; gap:10px; max-height:460px; overflow-y:auto;">
                ${(d.audit_logs || []).map((a) => `
                  <div style="background:var(--bg-card); border:1px solid var(--border-subtle); padding:10px 12px; border-radius:10px;">
                    <div class="card-meta-row" style="margin-bottom:4px;">
                      <span class="badge badge-gold">${this.esc(a.action)}</span>
                      <span style="font-size:0.74rem; color:var(--text-secondary);">${this.esc(new Date(a.created_at).toLocaleString('ar-EG'))}</span>
                    </div>
                    <div style="font-size:0.78rem; color:var(--text-secondary);">الهدف: ${this.esc(a.target_type || '-')} #${this.esc(a.target_id || '-')} • IP: ${this.esc(a.ip_address || '-')}</div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="section-card">
              <div class="section-header"><h3 class="section-title">${this.icon("alert-triangle", 15)} أحداث الحماية والواتساب (${(d.security_events || []).length} / ${d.whatsapp_logs.length})</h3></div>
              <div style="display:flex; flex-direction:column; gap:10px; max-height:460px; overflow-y:auto;">
                ${(d.security_events || []).map((ev) => `
                  <div style="background:var(--bg-card); border:1px solid rgba(245,158,11,0.3); padding:10px 12px; border-radius:10px;">
                    <div class="card-meta-row" style="margin-bottom:4px;">
                      <span class="badge badge-danger">${this.esc(ev.event_type)}</span>
                      <span style="font-size:0.74rem; color:var(--text-secondary);">${this.esc(ev.phone || '')}</span>
                    </div>
                    <div style="font-size:0.78rem; color:var(--text-secondary);">${this.esc(ev.student_name || '')} — ${this.esc(ev.details || '')}</div>
                  </div>
                `).join('')}
                ${d.whatsapp_logs.map((w) => `
                  <div style="background:var(--bg-card); border:1px solid var(--border-subtle); padding:10px 12px; border-radius:10px;">
                    <div class="card-meta-row" style="margin-bottom:4px;">
                      <span class="badge badge-gold">إلى: ${this.esc(w.recipient_phone)}</span>
                      <span class="badge ${w.status === 'sent' ? 'badge-success' : w.status === 'failed' ? 'badge-danger' : 'badge-gold'}">${this.esc(w.status)}</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-secondary);">${this.esc(w.message_summary || '')}</div>
                    ${w.failure_reason ? `<div style="font-size:0.74rem; color:var(--danger-text); margin-top:4px;">السبب: ${this.esc(w.failure_reason)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    },

    renderAdminQuestionInputRow(index, existing = null) {
      const opts = existing && Array.isArray(existing.options) ? existing.options : [];
      const correct = existing ? String(existing.correct_option || '').trim() : '';
      const inferredTf = existing && (existing.question_type === 'true_false' || (opts.length === 2 && opts.includes('صح') && opts.includes('خطأ')));
      const qType = inferredTf ? 'true_false' : 'mcq';
      const wrongOpts = opts.filter((o) => o !== correct);
      const pointsVal = Number(existing?.points || 2);

      return `
        <div class="question-box admin-q-row" style="margin-bottom:14px;">
          <div class="card-meta-row" style="margin-bottom:10px;">
            <span class="q-row-title" style="font-weight:800; color:var(--gold-400);">السؤال (${Number(index)})</span>
            <button type="button" class="btn btn-danger btn-sm" data-click="removeAdminQuestionRow">${this.icon("trash", 14)} حذف</button>
          </div>
          <div class="grid-3">
            <div class="form-group">
              <label>نوع السؤال</label>
              <select class="form-control q-type" data-change="onAdminQuestionTypeChange">
                <option value="mcq" ${qType === 'mcq' ? 'selected' : ''}>اختيار من متعدد (MCQ)</option>
                <option value="true_false" ${qType === 'true_false' ? 'selected' : ''}>صح أم خطأ</option>
              </select>
            </div>
            <div class="form-group"><label>المبحث الشرعي</label><input type="text" class="form-control q-topic" placeholder="مثال: أحكام الطلاق" value="${this.esc(existing?.topic_tag || '')}" required /></div>
            <div class="form-group"><label>الدرجات</label><input type="number" class="form-control q-points" min="1" max="100" value="${Number.isFinite(pointsVal) && pointsVal >= 1 ? pointsVal : 2}" required /></div>
          </div>
          <div class="form-group"><label>نص السؤال</label><input type="text" class="form-control q-text" placeholder="اكتب السؤال أو العبارة الشرعية هنا..." value="${this.esc(existing?.question_text || '')}" required /></div>
          <div class="q-mcq-fields grid-4" style="${qType === 'true_false' ? 'display:none;' : ''}">
            <div class="form-group"><label style="color:var(--success-text);">الإجابة الصحيحة</label><input type="text" class="form-control q-opt1" placeholder="الإجابة الصحيحة" value="${this.esc(qType === 'mcq' ? correct : '')}" ${qType === 'mcq' ? 'required' : ''} /></div>
            <div class="form-group"><label>اختيار خاطئ ١</label><input type="text" class="form-control q-opt2" placeholder="اختيار ٢" value="${this.esc(qType === 'mcq' ? (wrongOpts[0] || '') : '')}" ${qType === 'mcq' ? 'required' : ''} /></div>
            <div class="form-group"><label>اختيار خاطئ ٢</label><input type="text" class="form-control q-opt3" placeholder="اختيار ٣" value="${this.esc(qType === 'mcq' ? (wrongOpts[1] || '') : '')}" /></div>
            <div class="form-group"><label>اختيار خاطئ ٣</label><input type="text" class="form-control q-opt4" placeholder="اختيار ٤" value="${this.esc(qType === 'mcq' ? (wrongOpts[2] || '') : '')}" /></div>
          </div>
          <div class="q-tf-fields" style="${qType === 'true_false' ? '' : 'display:none;'} margin-bottom:12px;">
            <div class="form-group" style="margin-bottom:0;">
              <label>الإجابة الصحيحة (صح أم خطأ)</label>
              <select class="form-control q-tf-correct">
                <option value="صح" ${correct !== 'خطأ' ? 'selected' : ''}>العبارة صحيحة (صح)</option>
                <option value="خطأ" ${correct === 'خطأ' ? 'selected' : ''}>العبارة خاطئة (خطأ)</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0;"><label>التعليل الشرعي (اختياري)</label><input type="text" class="form-control q-exp" placeholder="التوضيح الشرعي للطالب بعد الحل..." value="${this.esc(existing?.explanation || '')}" /></div>
        </div>
      `;
    },

    onAdminQuestionTypeChange(selectEl) {
      const row = selectEl.closest('.admin-q-row');
      if (!row) return;
      const isTf = selectEl.value === 'true_false';
      const mcqBox = row.querySelector('.q-mcq-fields');
      const tfBox = row.querySelector('.q-tf-fields');
      const opt1 = row.querySelector('.q-opt1');
      const opt2 = row.querySelector('.q-opt2');
      if (mcqBox) mcqBox.style.display = isTf ? 'none' : '';
      if (tfBox) tfBox.style.display = isTf ? '' : 'none';
      if (opt1) opt1.required = !isTf;
      if (opt2) opt2.required = !isTf;
    },

    removeAdminQuestionRow(btnEl) {
      const row = btnEl.closest('.admin-q-row');
      const container = row ? row.parentElement : null;
      if (!row || !container) return;
      if (container.querySelectorAll('.admin-q-row').length <= 1) {
        this.showToast('يجب أن يحتوي الاختبار على سؤال واحد على الأقل.', 'warning');
        return;
      }
      row.remove();
      container.querySelectorAll('.admin-q-row').forEach((r, idx) => {
        const titleEl = r.querySelector('.q-row-title');
        if (titleEl) titleEl.textContent = `السؤال (${idx + 1})`;
      });
    },

    addMoreQuestionRow(containerId = 'adminMcqQuestionsList') {
      const container = document.getElementById(containerId);
      if (!container) return;
      const count = container.querySelectorAll('.admin-q-row').length + 1;
      const div = document.createElement('div');
      div.innerHTML = this.renderAdminQuestionInputRow(count);
      container.appendChild(div.firstElementChild);
    },

    async uploadToBunnyStream(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const statusEl = document.getElementById('bunnyUploadStatus');
      const titleInput = document.getElementById('newLessonTitle');
      const bunnyIdInput = document.getElementById('newLessonBunnyId');
      const title = (titleInput?.value || file.name.replace(/\.[^/.]+$/, '')).trim();
      const csrf = this.csrfToken || this.getCookie('matn_csrf_token') || '';
      if (statusEl) statusEl.textContent = 'جاري رفع الفيديو إلى Bunny Stream...';

      try {
        const res = await fetch('/api/admin/bunny/upload', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
            'X-CSRF-Token': csrf,
            'X-Device-Id': this.deviceId,
            'X-File-Name': encodeURIComponent(file.name),
            'X-Video-Title': encodeURIComponent(title)
          },
          body: file
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'فشل الرفع إلى Bunny Stream');
        if (bunnyIdInput) bunnyIdInput.value = data.guid;
        if (statusEl) statusEl.textContent = `تم الرفع بنجاح — GUID: ${data.guid}`;
        this.showToast(data.message, 'success');
      } catch (err) {
        if (statusEl) statusEl.textContent = `فشل الرفع: ${err.message}`;
        this.showToast(err.message, 'danger');
      }
    },

    async uploadAdminFile(inputEl, uploadType) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;

      const titleInput = document.getElementById('newLessonTitle');
      if (titleInput && !titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^/.]+$/, '');

      const statusEl = document.getElementById(uploadType === 'pdf' ? 'pdfUploadStatus' : 'videoUploadStatus');
      const progWrap = document.getElementById(uploadType === 'pdf' ? 'pdfProgressWrap' : 'videoProgressWrap');
      const progBar = document.getElementById(uploadType === 'pdf' ? 'pdfProgressBar' : 'videoProgressBar');
      const submitBtn = document.getElementById('publishLessonSubmitBtn');

      if (progWrap) progWrap.style.display = 'block';
      if (progBar) progBar.style.width = '0%';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `${this.icon('upload', 15)} <span>جاري فحص ورفع الملف... يرجى الانتظار</span>`;
      }

      const chunkSize = 2 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
      const uploadId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const totalMb = (file.size / (1024 * 1024)).toFixed(1);
      const csrf = this.csrfToken || this.getCookie('matn_csrf_token') || '';

      try {
        let finalData = null;
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunkBlob = file.slice(start, end);

          const pct = Math.round((chunkIndex / totalChunks) * 100);
          const curMb = (start / (1024 * 1024)).toFixed(1);
          statusEl.textContent = `جاري الرفع: ${pct}% (${curMb} / ${totalMb} MB)`;
          if (progBar) progBar.style.width = `${pct}%`;

          const res = await fetch('/api/admin/upload-chunk', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
              'X-CSRF-Token': csrf,
              'X-Device-Id': this.deviceId,
              'X-Upload-Type': uploadType,
              'X-Upload-Id': uploadId,
              'X-Chunk-Index': String(chunkIndex),
              'X-Total-Chunks': String(totalChunks),
              'X-File-Name': encodeURIComponent(file.name)
            },
            body: chunkBlob
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'فشل رفع الجزء');
          finalData = data;
        }

        if (progBar) progBar.style.width = '100%';
        if (uploadType === 'pdf') document.getElementById('uploadedPdfPath').value = finalData.file_path;
        else document.getElementById('uploadedVideoPath').value = finalData.file_path;
        statusEl.textContent = `تم الرفع والتحقق 100% (${totalMb} MB)`;
        this.showToast(finalData.message, 'success');
      } catch (err) {
        statusEl.textContent = `فشل الرفع: ${err.message}`;
        this.showToast(err.message, 'danger');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `${this.icon('zap', 15)} <span>حفظ ونشر المحاضرة والمذكرة للطلاب الآن</span>`;
        }
      }
    },

    async handleCreateLesson(e) {
      e.preventDefault();
      const body = {
        title: document.getElementById('newLessonTitle').value.trim() || 'محاضرة جديدة - منصة متن',
        subject: document.getElementById('newLessonSubject').value,
        grade: document.getElementById('newLessonGrade').value,
        branch: document.getElementById('newLessonBranch').value,
        unit_title: document.getElementById('newLessonUnit').value.trim() || 'الباب الأول',
        order_index: Number(document.getElementById('newLessonOrder').value || 1),
        duration_minutes: Number(document.getElementById('newLessonDuration').value || 45),
        video_type: document.getElementById('newLessonVideoType')?.value || 'upload',
        bunny_video_id: document.getElementById('newLessonBunnyId')?.value.trim() || '',
        video_path: document.getElementById('uploadedVideoPath')?.value || '',
        pdf_path: document.getElementById('uploadedPdfPath')?.value || ''
      };
      try {
        const res = await this.api('/api/admin/lessons', { method: 'POST', body: JSON.stringify(body) });
        this.showToast(res.message, 'success');
        this.adminTab = 'lessons_list';
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openEditLessonModal(lessonId) {
      const lesson = (this.adminData?.lessons || []).find((l) => l.id === lessonId);
      if (!lesson) return;
      const isPrep = this.isPrepGrade(lesson.grade);
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.1rem;">${this.icon("edit", 14)} تعديل المحاضرة</h3>
          <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
        </div>
        <form data-submit="handleEditLessonSubmit" data-id="${Number(lesson.id)}">
          <div class="form-group"><label>عنوان المحاضرة</label><input type="text" id="editLessonTitle" class="form-control" value="${this.esc(lesson.title)}" required /></div>
          <div class="form-row-3">
            <div class="form-group"><label>الصف الدراسي</label><select id="editLessonGrade" class="form-control" data-change="onEditLessonGradeChange">${this.renderGradeOptions(lesson.grade)}</select></div>
            <div class="form-group"><label>المادة</label><select id="editLessonSubject" class="form-control">${this.renderSubjectOptionsForGrade(lesson.grade, lesson.subject)}</select></div>
            <div class="form-group"><label>الشعبة</label><select id="editLessonBranch" class="form-control">${isPrep ? `<option value="general" ${lesson.branch === 'general' ? 'selected' : ''}>عام (المرحلة الإعدادية)</option><option value="both" ${lesson.branch === 'both' ? 'selected' : ''}>عام لجميع طلاب الصف</option>` : `<option value="both" ${lesson.branch === 'both' ? 'selected' : ''}>مشترك (علمي وأدبي)</option><option value="scientific" ${lesson.branch === 'scientific' ? 'selected' : ''}>القسم العلمي فقط</option><option value="literary" ${lesson.branch === 'literary' ? 'selected' : ''}>القسم الأدبي فقط</option>`}</select></div>
          </div>
          <div class="form-row-3">
            <div class="form-group"><label>الباب / الوحدة</label><input type="text" id="editLessonUnit" class="form-control" value="${this.esc(lesson.unit_title)}" required /></div>
            <div class="form-group"><label>ترتيب الحصة</label><input type="number" id="editLessonOrder" class="form-control" value="${Number(lesson.order_index)}" min="1" required /></div>
            <div class="form-group"><label>المدة (دقيقة)</label><input type="number" id="editLessonDuration" class="form-control" value="${Number(lesson.duration_minutes)}" min="1" required /></div>
          </div>
          <div class="form-group"><label>عنوان المذكرة</label><input type="text" id="editLessonPdfTitle" class="form-control" value="${this.esc(lesson.pdf_title || '')}" /></div>
          <div class="form-group"><label>وصف المحاضرة (اختياري)</label><textarea id="editLessonDescription" class="form-control" rows="2" maxlength="1000">${this.esc(lesson.description || '')}</textarea></div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon("save", 15)} حفظ التعديلات</button>
        </form>
      `, '680px');
    },

    async handleEditLessonSubmit(e, lessonId) {
      e.preventDefault();
      try {
        const res = await this.api(`/api/admin/lessons/${Number(lessonId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: document.getElementById('editLessonTitle').value.trim(),
            grade: document.getElementById('editLessonGrade').value,
            subject: document.getElementById('editLessonSubject').value,
            branch: document.getElementById('editLessonBranch').value,
            unit_title: document.getElementById('editLessonUnit').value.trim(),
            order_index: Number(document.getElementById('editLessonOrder').value),
            duration_minutes: Number(document.getElementById('editLessonDuration').value),
            pdf_title: document.getElementById('editLessonPdfTitle')?.value.trim(),
            description: document.getElementById('editLessonDescription')?.value.trim()
          })
        });
        this.closeModal();
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async toggleLessonPublish(lessonId, nextState) {
      try {
        const res = await this.api(`/api/admin/lessons/${Number(lessonId)}`, {
          method: 'PUT',
          body: JSON.stringify({ is_published: Boolean(nextState) })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async openLessonAssessmentsModal(lessonId) {
      try {
        const data = await this.api(`/api/admin/lessons/${Number(lessonId)}/assessments`);
        this._loadedLessonAssessments = data.assessments || [];
        this.openModal(`
          <div class="card-meta-row">
            <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("file-text", 15)} اختبارات: ${this.esc(data.lesson_title)}</h3>
            <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; max-height:65vh; overflow-y:auto;">
            ${data.assessments.length === 0 ? `<p style="text-align:center; color:var(--text-secondary);">لا توجد اختبارات مرتبطة بهذه المحاضرة.</p>` : data.assessments.map((a) => `
              <div style="background:var(--bg-card); border:1px solid var(--border-subtle); padding:12px; border-radius:10px;">
                <div class="card-meta-row">
                  <div>
                    <span class="badge badge-gold">${this.esc(a.assessment_type)}</span>
                    <span class="badge ${a.is_active ? 'badge-success' : 'badge-danger'}">${a.is_active ? 'مفعل' : 'مخفي'}</span>
                  </div>
                  <span style="font-size:0.78rem; color:var(--text-secondary);">${a.questions.length} سؤال • ${Number(a.time_limit_minutes)} د</span>
                </div>
                <div style="font-weight:800; color:var(--text-primary); margin-bottom:8px;">${this.esc(a.title)}</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-outline-gold btn-sm" data-click="openEditAssessmentModal" data-id="${Number(a.id)}" data-lesson-id="${Number(lessonId)}">${this.icon("edit", 14)} تعديل الأسئلة والموعد</button>
                  <button class="btn btn-emerald btn-sm" data-click="toggleAssessmentActive" data-id="${Number(a.id)}" data-next="${a.is_active ? 0 : 1}" data-lesson-id="${Number(lessonId)}">${a.is_active ? 'إخفاء' : 'تفعيل'}</button>
                  <button class="btn btn-danger btn-sm" data-click="deleteAssessment" data-id="${Number(a.id)}" data-lesson-id="${Number(lessonId)}">${this.icon("trash", 14)} حذف</button>
                </div>
              </div>
            `).join('')}
          </div>
        `, '680px');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openEditAssessmentModal(assessmentId, lessonId) {
      const a = (this._loadedLessonAssessments || []).find((x) => x.id === assessmentId);
      if (!a) return;
      const toLocal = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("edit", 14)} تعديل الاختبار والأسئلة</h3>
          <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
        </div>
        <form data-submit="handleEditAssessmentSubmit" data-id="${Number(a.id)}" data-lesson-id="${Number(lessonId)}">
          <div class="grid-3">
            <div class="form-group"><label>العنوان</label><input type="text" id="editExamTitle" class="form-control" value="${this.esc(a.title)}" required /></div>
            <div class="form-group"><label>المدة (دقيقة)</label><input type="number" id="editExamTimeLimit" class="form-control" value="${Number(a.time_limit_minutes)}" min="1" max="180" required /></div>
            <div class="form-group"><label>النوع</label><select id="editExamType" class="form-control"><option value="exam" ${a.assessment_type === 'exam' ? 'selected' : ''}>امتحان أساسي</option><option value="homework" ${a.assessment_type === 'homework' ? 'selected' : ''}>واجب</option><option value="retake_exam" ${a.assessment_type === 'retake_exam' ? 'selected' : ''}>امتحان ملحق</option></select></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label>موعد الفتح (اختياري)</label><input type="datetime-local" id="editExamStart" class="form-control" value="${toLocal(a.scheduled_start)}" /></div>
            <div class="form-group"><label>موعد الإغلاق (اختياري)</label><input type="datetime-local" id="editExamEnd" class="form-control" value="${toLocal(a.scheduled_end)}" /></div>
          </div>
          <div id="editExamQuestionsList" style="max-height:42vh; overflow-y:auto; margin-top:8px;">
            ${(a.questions || []).map((q, idx) => this.renderAdminQuestionInputRow(idx + 1, q)).join('')}
          </div>
          <div class="card-meta-row" style="margin-top:12px; margin-bottom:0;">
            <button type="button" class="btn btn-outline-gold btn-sm" data-click="addMoreQuestionRow" data-container="editExamQuestionsList">${this.icon("plus", 15)} إضافة سؤال</button>
            <button type="submit" class="btn btn-gold">${this.icon("save", 15)} حفظ التعديلات</button>
          </div>
        </form>
      `, '760px');
    },

    collectQuestionsFromContainer(containerSelector) {
      const rows = document.querySelectorAll(`${containerSelector} .admin-q-row`);
      const questions = [];
      rows.forEach((row) => {
        const qType = row.querySelector('.q-type')?.value === 'true_false' ? 'true_false' : 'mcq';
        const qText = row.querySelector('.q-text').value.trim();
        const topic = row.querySelector('.q-topic').value.trim();
        const points = Math.min(Math.max(Number(row.querySelector('.q-points')?.value || 2) || 2, 1), 100);
        const exp = row.querySelector('.q-exp').value.trim();
        if (qType === 'true_false') {
          const tfCorrect = row.querySelector('.q-tf-correct')?.value === 'خطأ' ? 'خطأ' : 'صح';
          questions.push({ question_type: 'true_false', question_text: qText, topic_tag: topic || 'مباحث الدرس', options: ['صح', 'خطأ'], correct_option: tfCorrect, explanation: exp, points });
          return;
        }
        const opt1 = row.querySelector('.q-opt1').value.trim();
        const opt2 = row.querySelector('.q-opt2').value.trim();
        const opt3 = row.querySelector('.q-opt3').value.trim();
        const opt4 = row.querySelector('.q-opt4').value.trim();
        questions.push({ question_type: 'mcq', question_text: qText, topic_tag: topic || 'مباحث الدرس', options: [opt1, opt2, opt3, opt4].filter(Boolean), correct_option: opt1, explanation: exp, points });
      });
      return questions;
    },

    async handleEditAssessmentSubmit(e, assessmentId, lessonId) {
      e.preventDefault();
      const startVal = document.getElementById('editExamStart').value;
      const endVal = document.getElementById('editExamEnd').value;
      try {
        const res = await this.api(`/api/admin/assessments/${Number(assessmentId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: document.getElementById('editExamTitle').value.trim(),
            assessment_type: document.getElementById('editExamType').value,
            time_limit_minutes: Number(document.getElementById('editExamTimeLimit').value),
            scheduled_start: startVal ? new Date(startVal).toISOString() : null,
            scheduled_end: endVal ? new Date(endVal).toISOString() : null,
            questions: this.collectQuestionsFromContainer('#editExamQuestionsList')
          })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
        await this.openLessonAssessmentsModal(lessonId);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async toggleAssessmentActive(assessmentId, nextActive, lessonId) {
      try {
        const res = await this.api(`/api/admin/assessments/${Number(assessmentId)}`, { method: 'PUT', body: JSON.stringify({ is_active: Boolean(nextActive) }) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
        await this.openLessonAssessmentsModal(lessonId);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteAssessment(assessmentId, lessonId) {
      if (!window.confirm('هل أنت متأكد من حذف هذا الاختبار وجميع أسئلته ونتائجه نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/assessments/${Number(assessmentId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
        await this.openLessonAssessmentsModal(lessonId);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteLesson(lessonId) {
      if (!window.confirm('هل أنت متأكد من حذف هذه المحاضرة وملفاتها غير المستخدمة نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/lessons/${Number(lessonId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleCreateAssessment(e) {
      e.preventDefault();
      const lesson_id = Number(document.getElementById('examLessonId').value);
      const assessment_type = document.getElementById('examTypeSelect').value;
      const time_limit_minutes = Number(document.getElementById('examTimeLimit').value);
      const title = document.getElementById('examTitleInput').value.trim();
      const startVal = document.getElementById('examScheduledStart')?.value || '';
      const endVal = document.getElementById('examScheduledEnd')?.value || '';
      const questions = this.collectQuestionsFromContainer('#adminMcqQuestionsList');
      try {
        const res = await this.api('/api/admin/assessments', {
          method: 'POST',
          body: JSON.stringify({
            lesson_id, assessment_type, time_limit_minutes, title,
            scheduled_start: startVal ? new Date(startVal).toISOString() : null,
            scheduled_end: endVal ? new Date(endVal).toISOString() : null,
            questions
          })
        });
        this.showToast(res.message, 'success');
        this.adminTab = 'lessons_list';
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openScheduleRetakeModal(lessonId) {
      const lesson = (this.adminData?.lessons || []).find((l) => l.id === lessonId);
      const lessonTitle = this.esc(lesson ? lesson.title : 'المحاضرة');
      const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const endLocal = new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

      this.openModal(`
        <h3 style="color:var(--gold-400); margin-bottom:6px; font-size:1.15rem;">${this.icon("calendar", 15)} جدولة «امتحان الراسبين (الملحق)»</h3>
        <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:14px;">المحاضرة: <b>${lessonTitle}</b></p>
        <form data-submit="handleScheduleRetakeSubmit" data-id="${Number(lessonId)}">
          <div class="form-group"><label>عنوان امتحان الراسبين</label><input type="text" id="retakeTitle" class="form-control" value="امتحان الإعادة للراسبين - ${lessonTitle}" required /></div>
          <div class="form-row-3">
            <div class="form-group"><label>موعد الفتح</label><input type="datetime-local" id="retakeStart" class="form-control" value="${nowLocal}" required /></div>
            <div class="form-group"><label>موعد الإغلاق</label><input type="datetime-local" id="retakeEnd" class="form-control" value="${endLocal}" required /></div>
            <div class="form-group"><label>المدة (دقيقة)</label><input type="number" id="retakeDuration" class="form-control" value="15" required /></div>
          </div>
          <div id="retakeQuestionsList" style="max-height:42vh; overflow-y:auto; margin-bottom:12px;">${this.renderAdminQuestionInputRow(1)}</div>
          <div class="card-meta-row" style="margin-bottom:0;">
            <button type="button" class="btn btn-outline-gold btn-sm" data-click="addMoreQuestionRow" data-container="retakeQuestionsList">${this.icon("plus", 15)} إضافة سؤال</button>
            <button type="submit" class="btn btn-gold" style="flex:1;">${this.icon("zap", 15)} اعتماد وجدولة الملحق</button>
            <button type="button" class="btn btn-danger" data-click="closeModal">إلغاء</button>
          </div>
        </form>
      `, '740px');
    },

    async handleScheduleRetakeSubmit(e, lessonId) {
      e.preventDefault();
      try {
        const res = await this.api('/api/admin/assessments', {
          method: 'POST',
          body: JSON.stringify({
            lesson_id: lessonId,
            assessment_type: 'retake_exam',
            title: document.getElementById('retakeTitle').value.trim(),
            time_limit_minutes: Number(document.getElementById('retakeDuration').value),
            scheduled_start: new Date(document.getElementById('retakeStart').value).toISOString(),
            scheduled_end: new Date(document.getElementById('retakeEnd').value).toISOString(),
            questions: this.collectQuestionsFromContainer('#retakeQuestionsList')
          })
        });
        this.closeModal();
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async verifyStudentWhatsappManually(studentId) {
      try {
        const res = await this.api('/api/admin/students/verify-whatsapp', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openResetStudentPasswordModal(studentId, studentName) {
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("key", 14)} تعيين كلمة مرور مؤقتة للطالب</h3>
          <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
        </div>
        <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">الطالب: <b>${this.esc(studentName || `#${Number(studentId)}`)}</b> — سيتم إنهاء أي جلسات قديمة تلقائياً.</p>
        <form data-submit="handleAdminResetPasswordSubmit" data-id="${Number(studentId)}">
          <div class="form-group"><label>كلمة المرور المؤقتة الجديدة (٨ أحرف على الأقل)</label><input type="text" id="adminTempStudentPassword" class="form-control" minlength="8" maxlength="128" placeholder="اكتب كلمة مرور مؤقتة..." required /></div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:12px;">${this.icon("save", 15)} حفظ كلمة المرور المؤقتة</button>
        </form>
      `);
    },

    async handleAdminResetPasswordSubmit(e, studentId) {
      e.preventDefault();
      try {
        const res = await this.api('/api/admin/students/reset-password', {
          method: 'POST',
          body: JSON.stringify({ student_id: studentId, new_password: document.getElementById('adminTempStudentPassword')?.value || '' })
        });
        this.closeModal();
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async resetStudentDevice(studentId) {
      try {
        const res = await this.api('/api/admin/students/reset-device', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async setStudentLockStatus(studentId, shouldLock) {
      try {
        const res = await this.api(shouldLock ? '/api/admin/students/lock' : '/api/admin/students/unlock', {
          method: 'POST',
          body: JSON.stringify({ student_id: studentId })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async grantStudentMonth(studentId) {
      try {
        const res = await this.api('/api/admin/students/grant-month', { method: 'POST', body: JSON.stringify({ student_id: studentId }) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteStudentAccount(studentId) {
      if (!window.confirm('هل أنت متأكد من حذف حساب هذا الطالب وجميع بياناته نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/students/${Number(studentId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async openSendVoucherModal(voucherId) {
      const v = (this.adminData?.vouchers || []).find((x) => x.id === voucherId);
      if (!v || v.is_used) return;
      let studentsList = this.adminData?.students || [];
      try {
        const sRes = await this.api('/api/admin/students/search');
        if (Array.isArray(sRes.students)) studentsList = sRes.students;
      } catch {}
      this._sendVoucherStudentCache = studentsList;
      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("smartphone", 15)} إرسال كود التفعيل عبر واتساب</h3>
          <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
        </div>
        <div class="scratch-code-box" style="margin:6px 0 6px;">${this.esc(v.code)}</div>
        <div style="text-align:center; font-size:0.76rem; color:var(--text-secondary); margin-bottom:12px;">
          النطاق: <b>${this.esc(v.grade_scope === 'all' ? 'كل الصفوف' : (GRADES_META[v.grade_scope] || v.grade_scope))}</b> •
          <b>${this.esc(v.subject_scope === 'all' ? 'كل المواد' : (SUBJECTS_META[v.subject_scope]?.name || v.subject_scope))}</b>
        </div>
        <form data-submit="handleSendVoucherSubmit" data-id="${Number(v.id)}">
          <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:12px; padding:12px; margin-bottom:12px;">
            <div style="font-weight:800; color:var(--gold-300); font-size:0.84rem; margin-bottom:8px;">اختيار طالب مسجل بالفعل (أو اكتب اسمه ورقمه بالأسفل):</div>
            <div class="form-group" style="margin-bottom:8px;"><input type="text" id="sendVoucherStudentSearch" class="form-control" placeholder="ابحث باسم الطالب أو رقم هاتفه..." data-input="searchRegisteredStudentsForVoucher" /></div>
            <div class="form-group" style="margin-bottom:0;">
              <select id="sendVoucherStudentSelect" class="form-control" data-change="onSelectRegisteredStudentForVoucher">
                <option value="">-- طالب جديد (سأكتب اسمه ورقمه يدوياً بالأسفل) --</option>
                ${studentsList.map((st) => `<option value="${Number(st.id)}" data-name="${this.esc(st.full_name)}" data-phone="${this.esc(st.phone)}">${this.esc(st.full_name)} • ${this.esc(st.phone)} (${this.esc(GRADES_META[st.grade] || st.grade)})</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group"><label>اسم الطالب في رسالة الترحيب *</label><input type="text" id="sendVoucherName" class="form-control" placeholder="مثال: أحمد محمد" value="${this.esc(v.assigned_to_name || '')}" required /></div>
            <div class="form-group"><label>رقم الواتساب المستلم (١١ رقماً) *</label><input type="tel" id="sendVoucherPhone" class="form-control" placeholder="010xxxxxxxx" value="${this.esc(v.assigned_to_phone || '')}" required /></div>
          </div>
          <label style="display:flex; align-items:flex-start; gap:8px; background:rgba(16,185,129,0.08); border:1px solid var(--border-gold); border-radius:10px; padding:10px 12px; margin-bottom:14px; cursor:pointer; font-size:0.82rem;">
            <input type="checkbox" id="sendVoucherRestrictPhone" ${v.restrict_to_phone ? 'checked' : ''} style="margin-top:3px;" />
            <div><b>${this.icon("lock", 14)} قفل الكود على هذا الرقم فقط</b><div style="font-size:0.74rem; color:var(--text-secondary);">لا تفعّله إذا كنت ترسل الكود على رقم ولي الأمر.</div></div>
          </label>
          <button type="submit" class="btn btn-whatsapp" style="width:100%; padding:12px;">${this.icon("message-circle", 14)} حفظ الحجز وفتح واتساب الطالب بالرسالة الجاهزة</button>
        </form>
      `, '620px');
    },

    async searchRegisteredStudentsForVoucher(query) {
      const sel = document.getElementById('sendVoucherStudentSelect');
      if (!sel) return;
      try {
        const res = await this.api(`/api/admin/students/search?q=${encodeURIComponent(query || '')}`);
        const list = Array.isArray(res.students) ? res.students : [];
        this._sendVoucherStudentCache = list;
        sel.innerHTML = `<option value="">-- اختر طالباً من نتائج البحث (${list.length}) --</option>${list.map((st) => `<option value="${Number(st.id)}" data-name="${this.esc(st.full_name)}" data-phone="${this.esc(st.phone)}">${this.esc(st.full_name)} • ${this.esc(st.phone)} (${this.esc(GRADES_META[st.grade] || st.grade)})</option>`).join('')}`;
      } catch {}
    },

    onSelectRegisteredStudentForVoucher(selectEl) {
      const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
      if (!opt || !selectEl.value) return;
      const nameEl = document.getElementById('sendVoucherName');
      const phoneEl = document.getElementById('sendVoucherPhone');
      if (nameEl && opt.dataset.name) nameEl.value = opt.dataset.name;
      if (phoneEl && opt.dataset.phone) phoneEl.value = opt.dataset.phone;
    },

    async handleSendVoucherSubmit(e, voucherId) {
      e.preventDefault();
      const studentIdVal = document.getElementById('sendVoucherStudentSelect')?.value || '';
      const recipient_name = (document.getElementById('sendVoucherName')?.value || '').trim();
      const recipient_phone = this.normalizePhoneInput(document.getElementById('sendVoucherPhone')?.value || '');
      const restrict_to_phone = Boolean(document.getElementById('sendVoucherRestrictPhone')?.checked);
      try {
        const res = await this.api('/api/admin/vouchers/assign', {
          method: 'POST',
          body: JSON.stringify({
            voucher_id: voucherId,
            ...(studentIdVal ? { student_id: Number(studentIdVal) } : {}),
            recipient_name,
            recipient_phone,
            restrict_to_phone
          })
        });
        this.closeModal();
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
        const safeWa = this.safeHttpsUrl(res.whatsapp_url);
        if (safeWa) window.open(safeWa, '_blank', 'noopener,noreferrer');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async releaseVoucherAssignment(voucherId) {
      try {
        const res = await this.api('/api/admin/vouchers/assign', { method: 'POST', body: JSON.stringify({ voucher_id: voucherId, action: 'release' }) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    buildQuickVoucherGreetingTemplate(name, gradeScope = 'all', subjectScope = 'all') {
      const cleanName = String(name || '').trim() || 'طالبنا العزيز';
      const gradeLabel = gradeScope && gradeScope !== 'all' ? (GRADES_META[gradeScope] || gradeScope) : '';
      const subjLabel = subjectScope && subjectScope !== 'all' ? (SUBJECTS_META[subjectScope]?.name || subjectScope) : 'الباقة الشاملة (جميع المواد)';
      const scopeLine = gradeLabel ? `الاشتراك: ${subjLabel} — ${gradeLabel}` : `الاشتراك: ${subjLabel}`;
      return [
        `وعليكم السلام ورحمة الله وبركاته يا ${cleanName}`,
        'تم تأكيد استلام التحويل بنجاح.',
        `اتفضل كود التفعيل الخاص باشتراكك في منصة مَتْن (${scopeLine}):`,
        '{CODE}',
        'ادخل المنصة واضغط «حساب طالب جديد» (أو «شحن كود» من داخل حسابك) واكتب الكود.',
        'بالتوفيق والسداد إن شاء الله!'
      ].join('\n');
    },

    parseQuickVoucherRequest(rawText) {
      const text = String(rawText || '');
      this._quickVoucherRaw = text;
      const normalizedText = this.normalizeDigits(text);

      // Extract Egyptian phone numbers (prioritize phone labeled as account/student phone over transfer phone)
      const phoneRegex = /(?:\+?20|0020)?(0?1[0125]\d{8})/g;
      const accountMatch = normalizedText.match(/(?:رقم\s*(?:هاتف\s*)?(?:الحساب|الطالب|الواتس(?:اب)?)|واتس(?:اب)?|رقمي)\s*[:\-]?\s*(?:\+?20|0020)?(0?1[0125]\d{8})/);
      let detectedPhone = '';
      if (accountMatch && accountMatch[1]) {
        detectedPhone = accountMatch[1].startsWith('0') ? accountMatch[1] : `0${accountMatch[1]}`;
      } else {
        const allMatches = [...normalizedText.matchAll(phoneRegex)];
        if (allMatches.length > 0 && allMatches[0][1]) {
          const p = allMatches[0][1];
          detectedPhone = p.startsWith('0') ? p : `0${p}`;
        }
      }

      // Extract student name
      let detectedName = '';
      const labeledName = normalizedText.match(/(?:أنا\s*الطالب(?:ة)?|اسم(?:ي|\s*الطالب(?:ة)?)?|الطالب(?:ة)?)\s*[:\-]?\s*([^\n\r،,0-9]{2,60})/);
      if (labeledName && labeledName[1]) {
        detectedName = labeledName[1]
          .replace(/(?:حولت|حوّلت|عاوز|محتاج|اريد|أريد|كود|تفعيل|الصف|من\s*رقم|رقم).*/u, '')
          .trim();
      } else {
        const anaMatch = normalizedText.match(/\bأنا\s+([^\n\r،,0-9]{2,50})/);
        if (anaMatch && anaMatch[1]) {
          detectedName = anaMatch[1]
            .replace(/(?:حولت|حوّلت|عاوز|محتاج|كود|في\s*سنة|الصف|بعت).*/u, '')
            .trim();
        }
      }

      // Detect Grade
      let detectedGrade = '';
      if (/الاول\s*الاعدادي|الأول\s*الإعدادي|اولى?\s*اعدادي|1\s*اعدادي/u.test(normalizedText)) detectedGrade = 'prep_1';
      else if (/الثاني\s*الاعدادي|الثاني\s*الإعدادي|تانية?\s*اعدادي|ثانية?\s*اعدادي|2\s*اعدادي/u.test(normalizedText)) detectedGrade = 'prep_2';
      else if (/الثالث\s*الاعدادي|الثالث\s*الإعدادي|تالتة?\s*اعدادي|ثالثة?\s*اعدادي|3\s*اعدادي/u.test(normalizedText)) detectedGrade = 'prep_3';
      else if (/الاول\s*الثانوي|الأول\s*الثانوي|اولى?\s*ثانوي|1\s*ثانوي/u.test(normalizedText)) detectedGrade = 'grade_1';
      else if (/الثاني\s*الثانوي|الثاني\s*الثانوي|تانية?\s*ثانوي|ثانية?\s*ثانوي|2\s*ثانوي/u.test(normalizedText)) detectedGrade = 'grade_2';
      else if (/الثالث\s*الثانوي|الثالث\s*الثانوي|تالتة?\s*ثانوي|ثالثة?\s*ثانوي|3\s*ثانوي/u.test(normalizedText)) detectedGrade = 'grade_3';

      // Detect single subject only if explicitly named
      let detectedSubject = '';
      if (/مواريث/u.test(normalizedText)) detectedSubject = 'mawareeth';
      else if (/تفسير/u.test(normalizedText)) detectedSubject = 'tafseer';
      else if (/حديث/u.test(normalizedText)) detectedSubject = 'hadith';
      else if (/توحيد/u.test(normalizedText)) detectedSubject = 'tawheed';
      else if (/فقه/u.test(normalizedText)) detectedSubject = 'fiqh';
      else if (/سيرة/u.test(normalizedText)) detectedSubject = 'seerah';
      else if (/تجويد/u.test(normalizedText)) detectedSubject = 'tajweed';

      const nameEl = document.getElementById('quickReplyName');
      const phoneEl = document.getElementById('quickReplyPhone');
      const gradeEl = document.getElementById('quickReplyGradeScope');
      const subjEl = document.getElementById('quickReplySubjectScope');

      if (detectedName && nameEl) {
        nameEl.value = detectedName;
        this._quickVoucherName = detectedName;
      }
      if (detectedPhone && phoneEl) {
        phoneEl.value = detectedPhone;
        this._quickVoucherPhone = detectedPhone;
      }
      if (detectedGrade && gradeEl) {
        gradeEl.value = detectedGrade;
        this._quickVoucherGrade = detectedGrade;
      }
      if (detectedSubject && subjEl) {
        subjEl.value = detectedSubject;
        this._quickVoucherSubject = detectedSubject;
      }

      if (!this._quickGreetingEditedManually) {
        this.onQuickVoucherFieldChange();
      }
    },

    onQuickVoucherFieldChange() {
      const nameVal = (document.getElementById('quickReplyName')?.value || '').trim();
      const phoneVal = (document.getElementById('quickReplyPhone')?.value || '').trim();
      const gradeVal = document.getElementById('quickReplyGradeScope')?.value || 'all';
      const subjVal = document.getElementById('quickReplySubjectScope')?.value || 'all';
      this._quickVoucherName = nameVal;
      this._quickVoucherPhone = phoneVal;
      this._quickVoucherGrade = gradeVal;
      this._quickVoucherSubject = subjVal;

      if (!this._quickGreetingEditedManually) {
        const msgBox = document.getElementById('quickReplyGreetingText');
        const nextText = this.buildQuickVoucherGreetingTemplate(nameVal, gradeVal, subjVal);
        this._quickVoucherGreeting = nextText;
        if (msgBox) msgBox.value = nextText;
      }
    },

    regenerateQuickGreeting() {
      this._quickGreetingEditedManually = false;
      this.onQuickVoucherFieldChange();
      this.showToast('تمت إعادة صياغة رسالة الترحيب بالبيانات الحالية.', 'success');
    },

    resetQuickVoucherReply() {
      this._quickVoucherRaw = '';
      this._quickVoucherName = '';
      this._quickVoucherPhone = '';
      this._quickVoucherGrade = 'all';
      this._quickVoucherSubject = 'all';
      this._quickVoucherRestrict = false;
      this._quickGreetingEditedManually = false;
      this._quickVoucherGreeting = this.buildQuickVoucherGreetingTemplate('', 'all', 'all');
      this._quickVoucherResult = null;
      this.renderAdminDashboard();
    },

    async handleQuickVoucherReplySubmit(e) {
      e.preventDefault();
      const recipient_name = (document.getElementById('quickReplyName')?.value || '').trim();
      const recipient_phone = this.normalizePhoneInput(document.getElementById('quickReplyPhone')?.value || '');
      const grade_scope = document.getElementById('quickReplyGradeScope')?.value || 'all';
      const subject_scope = document.getElementById('quickReplySubjectScope')?.value || 'all';
      const restrict_to_phone = Boolean(document.getElementById('quickReplyRestrictPhone')?.checked);
      const custom_message = (document.getElementById('quickReplyGreetingText')?.value || '').trim();

      this._quickVoucherName = recipient_name;
      this._quickVoucherPhone = recipient_phone;
      this._quickVoucherGrade = grade_scope;
      this._quickVoucherSubject = subject_scope;
      this._quickVoucherRestrict = restrict_to_phone;
      this._quickVoucherGreeting = custom_message;

      try {
        const res = await this.api('/api/admin/vouchers/assign', {
          method: 'POST',
          body: JSON.stringify({
            auto_pick: true,
            auto_generate_if_missing: true,
            grade_scope,
            subject_scope,
            recipient_name,
            recipient_phone,
            restrict_to_phone,
            custom_message
          })
        });
        this._quickVoucherResult = {
          code: res.voucher?.code || '',
          recipient_name,
          recipient_phone,
          whatsapp_url: res.whatsapp_url,
          whatsapp_message: res.whatsapp_message
        };
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
        const safeWa = this.safeHttpsUrl(res.whatsapp_url);
        if (safeWa) window.open(safeWa, '_blank', 'noopener,noreferrer');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleGenerateVouchers(e) {
      e.preventDefault();
      try {
        const res = await this.api('/api/admin/vouchers/generate', {
          method: 'POST',
          body: JSON.stringify({
            batch_name: document.getElementById('vBatchName').value.trim(),
            count: Number(document.getElementById('vCount').value),
            price_egp: Math.max(0, Number(document.getElementById('vPriceEgp')?.value ?? 150)),
            duration_days: 30,
            subject_scope: document.getElementById('vSubjectScope').value,
            grade_scope: document.getElementById('vGradeScope')?.value || 'all'
          })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    openBulkImportQuestionsModal(containerId = 'adminMcqQuestionsList') {
      const exampleText = [
        'س: كم عدد أركان الطلاق في المذهب الشافعي؟',
        'مبحث: أركان الطلاق',
        'درجة: 2',
        '* خمسة أركان',
        '- ثلاثة أركان',
        '- أربعة أركان',
        'تعليل: أركان الطلاق خمسة: مطلق وصيغة ومحل وولاية وقصد.',
        '',
        'س: الطلاق في الحيض محرم بدعي لكنه يقع شرعاً.',
        'صح أم خطأ: صح',
        'تعليل: يحرم لتطويل العدة ويقع شرعاً.'
      ].join('\n');

      this.openModal(`
        <div class="card-meta-row">
          <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("download", 14)} استيراد أسئلة دفعة واحدة</h3>
          <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:10px;">الصق الأسئلة مفصولة بسطر فارغ أو <code>---</code>.</p>
        <form data-submit="handleBulkImportQuestionsSubmit" data-container="${this.esc(containerId)}">
          <div class="form-group"><textarea id="bulkQuestionsTextarea" class="form-control" rows="11" style="font-size:0.84rem; line-height:1.6;" placeholder="${this.esc(exampleText)}" required></textarea></div>
          <button type="submit" class="btn btn-gold" style="width:100%; padding:11px;">${this.icon('zap', 15)} <span>إضافة الأسئلة المستوردة إلى النموذج</span></button>
        </form>
      `, '680px');
    },

    parseBulkQuestionsText(raw) {
      const blocks = String(raw || '').split(/\r?\n\s*(?:---+\s*\r?\n|\r?\n)+/).map((b) => b.trim()).filter(Boolean);
      const parsed = [];
      for (const block of blocks) {
        const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        let question_text = '';
        let topic_tag = 'مباحث الدرس';
        let explanation = '';
        let points = 2;
        let question_type = 'mcq';
        let correct_option = '';
        const options = [];
        for (const line of lines) {
          if (/^(?:س\s*[:\-]|Q\s*[:\-])/i.test(line)) question_text = line.replace(/^(?:س|Q)\s*[:\-]\s*/i, '').trim();
          else if (/^مبحث\s*[:\-]/.test(line)) topic_tag = line.replace(/^مبحث\s*[:\-]\s*/, '').trim() || 'مباحث الدرس';
          else if (/^تعليل\s*[:\-]/.test(line)) explanation = line.replace(/^تعليل\s*[:\-]\s*/, '').trim();
          else if (/^درجة\s*[:\-]/.test(line)) {
            const p = Number(this.normalizeDigits(line.replace(/^درجة\s*[:\-]\s*/, '').trim()));
            if (Number.isFinite(p) && p >= 1) points = Math.min(p, 100);
          } else if (/^(?:صح\s*(?:أو|أم|و)\s*خطأ|tf)\s*[:\-]/i.test(line)) {
            question_type = 'true_false';
            const ans = line.replace(/^(?:صح\s*(?:أو|أم|و)\s*خطأ|tf)\s*[:\-]\s*/i, '').trim();
            correct_option = (ans === 'خطأ' || ans === 'غلط' || ans.toLowerCase() === 'false') ? 'خطأ' : 'صح';
          } else if (/^\*/.test(line)) {
            const optText = line.replace(/^\*+\s*/, '').trim();
            if (optText) { correct_option = optText; options.unshift(optText); }
          } else if (/^[-•]/.test(line)) {
            const optText = line.replace(/^[-•]\s*/, '').trim();
            if (optText) options.push(optText);
          } else if (!question_text) question_text = line;
        }
        if (!question_text) continue;
        if (question_type === 'true_false') parsed.push({ question_type: 'true_false', question_text, topic_tag, options: ['صح', 'خطأ'], correct_option: correct_option || 'صح', explanation, points });
        else if (options.length >= 2) parsed.push({ question_type: 'mcq', question_text, topic_tag, options, correct_option: correct_option || options[0], explanation, points });
      }
      return parsed;
    },

    handleBulkImportQuestionsSubmit(e, containerId) {
      e.preventDefault();
      const parsed = this.parseBulkQuestionsText(document.getElementById('bulkQuestionsTextarea')?.value || '');
      if (parsed.length === 0) {
        this.showToast('لم يتم التعرف على أي سؤال صالح.', 'warning');
        return;
      }
      const container = document.getElementById(containerId);
      if (!container) return;
      const existingRows = container.querySelectorAll('.admin-q-row');
      if (existingRows.length === 1 && !existingRows[0].querySelector('.q-text')?.value.trim()) container.innerHTML = '';
      let startIdx = container.querySelectorAll('.admin-q-row').length;
      for (const q of parsed) {
        startIdx += 1;
        const div = document.createElement('div');
        div.innerHTML = this.renderAdminQuestionInputRow(startIdx, q);
        container.appendChild(div.firstElementChild);
      }
      this.closeModal();
      this.showToast(`تم استيراد ${parsed.length} سؤالاً إلى الاختبار بنجاح!`, 'success');
    },

    async openParentReportModal(studentId) {
      try {
        const res = await this.api(`/api/admin/students/${Number(studentId)}/parent-report`);
        const waSafe = this.safeHttpsUrl(res.whatsapp_url);
        this.openModal(`
          <div class="card-meta-row">
            <h3 style="color:var(--gold-400); font-size:1.05rem; display:flex; align-items:center; gap:7px;">${this.icon('bar-chart', 17)} <span>تقرير متابعة ولي الأمر</span></h3>
            <button class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
          </div>
          <div style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:10px;">
            الطالب: <b>${this.esc(res.student_name)}</b> • هاتف ولي الأمر: <b dir="ltr">${this.esc(res.parent_phone || 'غير مسجل')}</b>
          </div>
          <pre style="white-space:pre-wrap; font-family:inherit; font-size:0.84rem; background:var(--bg-card); border:1px solid var(--border-gold); padding:12px; border-radius:12px; margin-bottom:14px;">${this.esc(res.report_text)}</pre>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${waSafe ? `<a href="${this.esc(waSafe)}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp" style="flex:1;">${this.icon("smartphone", 15)} إرسال عبر واتساب ولي الأمر</a>` : `<div style="color:var(--danger-text); font-size:0.82rem;">رقم ولي الأمر غير مسجل أو غير صالح.</div>`}
            <button type="button" class="btn btn-outline-gold btn-sm" data-click="copyText" data-copy="${this.esc(res.report_text)}" data-label="نص التقرير">${this.icon("file-text", 14)} نسخ النص</button>
          </div>
        `, '620px');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async runWeeklyParentReports() {
      const includeAll = Boolean(document.getElementById('weeklyIncludeAllVerified')?.checked);
      try {
        const res = await this.api('/api/admin/weekly-reports/run', { method: 'POST', body: JSON.stringify({ include_all_verified: includeAll }) });
        this.adminTab = 'weekly_reports';
        this.showToast(res.message, res.gateway_configured ? 'success' : 'warning');
        await this.loadAdminDashboard(true);
        if (res.gateway_configured && res.in_progress) this.pollWeeklyReportProgress();
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    pollWeeklyReportProgress() {
      clearTimeout(this._weeklyPollTimer);
      this._weeklyPollTimer = setTimeout(async () => {
        if (this.currentView !== 'admin_dashboard' || this.adminTab !== 'weekly_reports') return;
        try {
          await this.loadAdminDashboard(true);
          const items = this.adminData?.weekly_reports?.items || [];
          if (items.some((i) => i.status === 'pending')) this.pollWeeklyReportProgress();
          else this.showToast('اكتمل إرسال جميع تقارير أولياء الأمور بالتتابع!', 'success');
        } catch {}
      }, 3000);
    },

    async copyAllWeeklyReports() {
      const items = this.adminData?.weekly_reports?.items || [];
      if (items.length === 0) {
        this.showToast('لا توجد تقارير لنسخها بعد.', 'warning');
        return;
      }
      const bundle = items.map((i, idx) => `#${idx + 1} | ${i.student_name} | ولي الأمر: ${i.parent_phone}\n${i.report_text}\n--------------------`).join('\n');
      await this.copyToClipboard(bundle, `قائمة ${items.length} تقريراً لأولياء الأمور`);
    },

    async sendNextSequentialWeeklyReport(reportId) {
      const item = (this.adminData?.weekly_reports?.items || []).find((i) => i.id === reportId);
      if (!item) return;
      const waSafe = this.safeHttpsUrl(item.whatsapp_url);
      if (waSafe) window.open(waSafe, '_blank', 'noopener,noreferrer');
      try {
        const res = await this.api(`/api/admin/weekly-reports/${Number(reportId)}/mark-sent`, { method: 'POST', body: JSON.stringify({}) });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleAnswerLessonQuestion(e, qId) {
      e.preventDefault();
      const form = e.target;
      const answer = form.querySelector('textarea[name="admin_answer"]')?.value.trim() || '';
      const isPublished = Boolean(form.querySelector('input[name="is_published"]')?.checked);
      try {
        const res = await this.api(`/api/admin/lesson-questions/${Number(qId)}`, {
          method: 'PUT',
          body: JSON.stringify({ admin_answer: answer, is_published: isPublished })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteLessonQuestion(qId) {
      if (!window.confirm('هل أنت متأكد من حذف هذا السؤال نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/lesson-questions/${Number(qId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleSaveSettings(e) {
      e.preventDefault();
      try {
        const res = await this.api('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify({
            platform_name: document.getElementById('setPlatformName').value.trim(),
            teacher_name: document.getElementById('setTeacherName').value.trim(),
            support_whatsapp: this.normalizePhoneInput(document.getElementById('setSupportWhatsapp').value),
            vodafone_cash_number: this.normalizePhoneInput(document.getElementById('setVodafoneCash')?.value || ''),
            instapay_handle: (document.getElementById('setInstapayHandle')?.value || '').trim(),
            auto_friday_reports_enabled: document.getElementById('setAutoFridayReports')?.checked ? '1' : '0',
            honor_roll_enabled: document.getElementById('setHonorRollEnabled')?.checked ? '1' : '0',
            azhar_exam_date: (document.getElementById('setAzharExamDate')?.value || '').trim(),
            announcement_banner: document.getElementById('setAnnouncementBanner').value.trim()
          })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    onLiveGradeChange() {
      const gradeEl = document.getElementById('liveGrade');
      const branchEl = document.getElementById('liveBranch');
      const subjEl = document.getElementById('liveSubject');
      if (!gradeEl || !branchEl) return;
      if (subjEl) subjEl.innerHTML = this.renderSubjectOptionsForGrade(gradeEl.value, subjEl.value);
      branchEl.innerHTML = this.isPrepGrade(gradeEl.value)
        ? '<option value="general" selected>عام (المرحلة الإعدادية)</option><option value="both">جميع طلاب الصف</option>'
        : '<option value="both" selected>مشترك (علمي وأدبي)</option><option value="scientific">علمي فقط</option><option value="literary">أدبي فقط</option>';
    },

    async handleCreateLiveSession(e) {
      e.preventDefault();
      try {
        const startsVal = document.getElementById('liveStartsAt').value;
        const res = await this.api('/api/admin/live-sessions', {
          method: 'POST',
          body: JSON.stringify({
            title: document.getElementById('liveTitle').value.trim(),
            grade: document.getElementById('liveGrade').value,
            subject: document.getElementById('liveSubject').value,
            branch: document.getElementById('liveBranch').value,
            starts_at: startsVal ? new Date(startsVal).toISOString() : '',
            duration_minutes: Number(document.getElementById('liveDuration').value || 60),
            provider: document.getElementById('liveProvider').value,
            stream_url: document.getElementById('liveStreamUrl').value.trim(),
            description: document.getElementById('liveDescription').value.trim()
          })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async updateLiveSessionStatus(sessionId, status) {
      try {
        const res = await this.api(`/api/admin/live-sessions/${Number(sessionId)}`, {
          method: 'PUT',
          body: JSON.stringify({ status })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async viewLiveAttendance(sessionId) {
      try {
        const res = await this.api(`/api/admin/live-sessions/${Number(sessionId)}/attendance`);
        const list = res.attendees || [];
        this.openModal(`
          <div class="card-meta-row">
            <h3 style="color:var(--gold-400); font-size:1.05rem;">${this.icon("file-text", 14)} سجل حضور: ${this.esc(res.session?.title || '')} (${list.length})</h3>
            <button type="button" class="btn btn-danger btn-sm" data-click="closeModal">${this.icon("x", 14)} إغلاق</button>
          </div>
          <div style="max-height:60vh; overflow-y:auto;">
            ${list.length === 0 ? `<div style="text-align:center; padding:20px; color:var(--text-secondary);">لم يسجل أي طالب حضوراً حتى الآن.</div>` : list.map((a) => `
              <div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid var(--border-subtle); font-size:0.84rem;">
                <span style="display:flex; align-items:center; gap:6px;">${this.icon('graduation-cap', 15)} <b>${this.esc(a.full_name)}</b> (<span dir="ltr">${this.esc(a.phone)}</span>)</span>
                <span style="color:var(--text-secondary);">${this.esc(new Date(a.joined_at).toLocaleString('ar-EG'))}</span>
              </div>
            `).join('')}
          </div>
        `, '580px');
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteLiveSession(sessionId) {
      if (!window.confirm('هل أنت متأكد من حذف هذه الحصة المباشرة وسجل حضورها نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/live-sessions/${Number(sessionId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async handleSendAdminNotification(e) {
      e.preventDefault();
      try {
        const res = await this.api('/api/admin/notifications', {
          method: 'POST',
          body: JSON.stringify({
            title: document.getElementById('notifTitle').value.trim(),
            target_grade: document.getElementById('notifGrade').value,
            target_branch: document.getElementById('notifBranch').value,
            body: document.getElementById('notifBody').value.trim()
          })
        });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    },

    async deleteAdminNotification(notifId) {
      if (!window.confirm('هل أنت متأكد من حذف هذا الإشعار نهائياً؟')) return;
      try {
        const res = await this.api(`/api/admin/notifications/${Number(notifId)}`, { method: 'DELETE' });
        this.showToast(res.message, 'success');
        await this.loadAdminDashboard(true);
      } catch (err) {
        this.showToast(err.message, 'danger');
      }
    }
  });
}
