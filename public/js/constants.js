export const SUBJECTS_META = {
  fiqh: { name: 'الفقه الشافعي', prepName: 'الفقه', stage: 'إعدادي وثانوي', iconName: 'scale', desc: 'أحكام العبادات والمعاملات بأدلتها الشرعية' },
  tafseer: { name: 'التفسير وعلوم القرآن', prepName: 'التفسير', stage: 'إعدادي وثانوي', iconName: 'book-open', desc: 'تفسير الآيات وبيان المعاني والأسرار البيانية' },
  hadith: { name: 'الحديث وعلومه', prepName: 'الحديث', stage: 'إعدادي وثانوي', iconName: 'scroll', desc: 'شرح الأحاديث النبوية والمباحث اللغوية' },
  tawheed: { name: 'التوحيد والعقيدة', prepName: 'التوحيد', stage: 'إعدادي وثانوي', iconName: 'landmark', desc: 'مباحث الإلهيات والنبوات على منهج الأزهر' },
  seerah: { name: 'السيرة النبوية', prepName: 'السيرة', stage: '١-٣ إعدادي', iconName: 'compass', desc: 'دراسة أحداث السيرة الشريفة والدروس المستفادة' },
  tajweed: { name: 'التجويد', prepName: 'التجويد', stage: '١-٣ إعدادي', iconName: 'mic', desc: 'أحكام التلاوة ومخارج الحروف وتطبيقاتها' },
  mawareeth: { name: 'المواريث', prepName: 'المواريث', stage: '٣ ثانوي أزهري', iconName: 'target', desc: 'أحكام الفرائض وتوزيع التركات وحل المسائل' }
};

export const PREP_GRADES = ['prep_1', 'prep_2', 'prep_3'];
export const PREP_SUBJECT_KEYS = ['fiqh', 'tafseer', 'hadith', 'tawheed', 'seerah', 'tajweed'];
export const SEC_BASE_SUBJECT_KEYS = ['fiqh', 'hadith', 'tawheed', 'tafseer'];
export const GRADE_3_SUBJECT_KEYS = ['fiqh', 'hadith', 'tawheed', 'tafseer', 'mawareeth'];

export const GRADES_META = {
  prep_1: 'الصف الأول الإعدادي الأزهري',
  prep_2: 'الصف الثاني الإعدادي الأزهري',
  prep_3: 'الصف الثالث الإعدادي الأزهري',
  grade_1: 'الصف الأول الثانوي الأزهري',
  grade_2: 'الصف الثاني الثانوي الأزهري',
  grade_3: 'الصف الثالث الثانوي الأزهري'
};

export const BRANCHES_META = {
  general: 'عام (المرحلة الإعدادية)',
  scientific: 'القسم العلمي',
  literary: 'القسم الأدبي',
  both: 'مشترك (علمي وأدبي)'
};
