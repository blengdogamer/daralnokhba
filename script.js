import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1uJ5bxyhijkiVNSopk-HJtCv075tgFXU",
  authDomain: "daralakshar.firebaseapp.com",
  databaseURL: "https://daralakshar-default-rtdb.firebaseio.com",
  projectId: "daralakshar",
  storageBucket: "daralakshar.firebasestorage.app",
  messagingSenderId: "588849018078",
  appId: "1:588849018078:web:2b1d8164517b2cf4d7fe4f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentSelectedItem = '';
let currentSelectedCvDocId = '';
const whatsappNumber = "966135756111"; 

// إعدادات بوت التليجرام والقناة
const TELEGRAM_BOT_TOKEN = "8967937243:AAGAepEyU1j0HQOC-5Ko43VmAhpUd6DnUpc";
const TELEGRAM_CHAT_ID = "-1004478651730";

async function loadAnnouncements() {
  const bannerSection = document.getElementById('bannerSection');
  const bannerContainer = document.getElementById('bannerImageContainer');

  try {
    const querySnapshot = await getDocs(collection(db, "announcements"));
    if (!querySnapshot.empty) {
      const slidesHTML = querySnapshot.docs.map(docSnap => {
        const item = docSnap.data();
        return `
          <div class="announcement-slide">
            <img src="${item.imageUrl}" alt="${item.title || 'إعلان'}" class="announcement-img">
          </div>
        `;
      }).join('');
      
      bannerContainer.innerHTML = slidesHTML;
      bannerSection.style.display = 'block';
    } else {
      bannerSection.style.display = 'none';
    }
  } catch (e) {
    console.error("خطأ جلب الإعلانات:", e);
  }
}

async function loadProducts(filters = {}) {
  const productsGrid = document.getElementById('productsGrid');
  productsGrid.innerHTML = '<p class="loading-msg">جاري تحميل السير الذاتية المتاحة...</p>';

  try {
    const qCvs = query(collection(db, "cvs"), where("status", "==", "نشط"));
    const [setSnap, querySnapshot] = await Promise.all([
      getDoc(doc(db, "settings", "categories")).catch(() => null),
      getDocs(qCvs)
    ]);

    let settings = {
      countriesOrder: ["الفلبين", "كينيا", "إثيوبيا", "سريلانكا", "الهند", "أوغندا"],
      firstExperience: "سبق لها العمل",
      firstJob: "عاملة منزلية"
    };

    if (setSnap && setSnap.exists()) {
      settings = setSnap.data();
    }

    let itemsList = [];

    querySnapshot.forEach((docSnap) => {
      const p = docSnap.data();
      const cvId = docSnap.id;

      if (filters.job && p.job !== filters.job) return;
      if (filters.serviceType && p.serviceType !== filters.serviceType) return;
      if (filters.country && p.country !== filters.country) return;
      if (filters.religion && p.religion !== filters.religion) return;
      if (filters.experience && p.experience !== filters.experience) return;

      itemsList.push({ cvId, ...p });
    });

    itemsList.sort((a, b) => {
      if (settings.firstServiceType) {
        const isServiceA = (a.serviceType === settings.firstServiceType || (settings.firstServiceType.includes("نقل") && a.serviceType?.includes("نقل")));
        const isServiceB = (b.serviceType === settings.firstServiceType || (settings.firstServiceType.includes("نقل") && b.serviceType?.includes("نقل")));
        if (isServiceA !== isServiceB) return isServiceA ? -1 : 1;
      }

      if (settings.countriesOrder && settings.countriesOrder.length > 0) {
        let indexA = settings.countriesOrder.indexOf(a.country);
        let indexB = settings.countriesOrder.indexOf(b.country);
        
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;

        if (indexA !== indexB) return indexA - indexB;
      }

      if (settings.firstExperience) {
        const isExpA = (a.experience === settings.firstExperience);
        const isExpB = (b.experience === settings.firstExperience);
        if (isExpA !== isExpB) return isExpA ? -1 : 1;
      }

      if (settings.firstJob) {
        const isJobA = (a.job === settings.firstJob);
        const isJobB = (b.job === settings.firstJob);
        if (isJobA !== isJobB) return isJobA ? -1 : 1;
      }

      return 0;
    });

    if (itemsList.length === 0) {
      productsGrid.innerHTML = '<p class="no-data">لا توجد عمالة متاحة طِبقاً لخيارات الفلترة.</p>';
      return;
    }

    const cardsHTML = itemsList.map(p => {
      const encodedMsg = encodeURIComponent(`السلام عليكم، أود الاستفسار عن السيرة الذاتية: ${p.title} (${p.job || 'عاملة منزلية'})`);
      const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodedMsg}`;

      return `
        <div class="card">
          <img src="${p.imageUrl || 'https://via.placeholder.com/140x180'}" class="card-img" onclick="openImagePreview('${p.imageUrl}')" title="اضغط لتكبير السيرة الذاتية">
          <div class="card-content">
            <div class="card-tag">${p.serviceType || 'إستقدام جديد'} - ${p.country}</div>
            <h4>${p.title}</h4>
            <p class="details">
              <strong>الوظيفة:</strong> ${p.job || 'عاملة منزلية'}<br>
              <strong>الديانة:</strong> ${p.religion}<br>
              <strong>الخبرة:</strong> ${p.experience}
            </p>
            <div class="card-actions-row">
              <button class="order-btn" onclick="openModal('${p.title}', '${p.cvId}')">إطلب الآن</button>
              <a href="${whatsappUrl}" target="_blank" class="whatsapp-btn">
                <span class="wa-icon">💬</span> واتساب
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');

    productsGrid.innerHTML = cardsHTML;

  } catch (e) {
    console.error("خطأ التحميل:", e);
    productsGrid.innerHTML = '<p class="error-msg">حدث خطأ أثناء تحميل البيانات من الخادم.</p>';
  }
}

window.openImagePreview = function(src) {
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('previewImageSrc');
  img.src = src;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeImagePreview = function(event) {
  if (event.target.id === 'imagePreviewModal') {
    closeImagePreviewDirect();
  }
};

window.closeImagePreviewDirect = function() {
  const modal = document.getElementById('imagePreviewModal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
};

document.getElementById('applyFilterBtn')?.addEventListener('click', () => {
  loadProducts({
    job: document.getElementById('filterJob').value,
    serviceType: document.getElementById('filterServiceType').value,
    country: document.getElementById('filterCountry').value,
    religion: document.getElementById('filterReligion').value,
    experience: document.getElementById('filterExperience').value
  });
});

window.openModal = function(itemTitle, cvDocId) {
  currentSelectedItem = itemTitle;
  currentSelectedCvDocId = cvDocId;
  document.getElementById('orderModal').style.display = 'flex';
};

window.closeModal = function() {
  document.getElementById('orderModal').style.display = 'none';
  document.getElementById('orderForm').reset();
  const visaFields = document.getElementById('visaFields');
  if (visaFields) visaFields.style.display = 'none';
};

window.toggleVisaFields = function() {
  const hasVisa = document.getElementById('hasVisa').checked;
  const visaFields = document.getElementById('visaFields');
  if (visaFields) {
    visaFields.style.display = hasVisa ? 'grid' : 'none';
  }
};

// دالة إرسال التنبيه لقناة التليجرام
async function sendTelegramNotification(orderData, timeFormatted) {
  try {
    let visaText = orderData.hasVisa ? "نعم (مرفقة التفاصيل)" : "لا يوجد";
    let message = `🚨 *وصل طلب جديد إلى الموقع!* 🚨\n\n`;
    message += `👤 *اسم العميل:* ${orderData.applicantName}\n`;
    message += `🪪 *رقم الهوية:* ${orderData.idNumber}\n`;
    message += `📅 *تاريخ الميلاد:* ${orderData.birthDate}\n`;
    message += `📞 *رقم الجوال:* ${orderData.phoneNumber}\n`;
    message += `📄 *طلب السيرة الذاتية:* ${orderData.selectedItem}\n`;
    message += `📑 *وجود تأشيرة:* ${visaText}\n`;

    if (orderData.hasVisa && orderData.visaDetails) {
      const v = orderData.visaDetails;
      message += `\n📋 *تفاصيل التأشيرة:*`;
      if (v.visaNumber) message += `\n• رقم الصادر: ${v.visaNumber}`;
      if (v.visaIssueDate) message += `\n• تاريخ الصادر: ${v.visaIssueDate}`;
      if (v.borderNumber) message += `\n• رقم الحدود: ${v.borderNumber}`;
      if (v.employerName) message += `\n• جهة العمل: ${v.employerName}`;
      if (v.workCity) message += `\n• مدينة العمل: ${v.workCity}`;
      if (v.address) message += `\n• العنوان: ${v.address}`;
      if (v.relativeName) message += `\n• القريب: ${v.relativeName} (${v.relativeRelation || 'قريب'})`;
      if (v.relativePhone) message += `\n• هاتف القريب: ${v.relativePhone}`;
      if (v.homeFloors) message += `\n• أدوار المنزل: ${v.homeFloors} | الغرف: ${v.homeRooms || '-'} | الأفراد: ${v.familyMembers || '-'}`;
    }

    if (orderData.note) {
      message += `\n\n📝 *ملاحظة العميل:* ${orderData.note}`;
    }

    message += `\n\n⏰ *وقت تقديم الطلب:* ${timeFormatted}`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("خطأ أثناء إرسال إشعار التليجرام:", err);
  }
}

window.handleOrderSubmit = async function(event) {
  event.preventDefault();

  const applicantName = document.getElementById('applicantName').value;
  const idNumber = document.getElementById('idNumber').value;
  const birthDate = document.getElementById('birthDate').value;
  const phoneNumber = document.getElementById('phoneNumber').value;
  const note = document.getElementById('note').value;
  const hasVisa = document.getElementById('hasVisa')?.checked || false;

  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-SA');
  const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fullTimeFormatted = `${dateStr} - ${timeStr}`;

  const orderData = {
    selectedItem: currentSelectedItem,
    applicantName: applicantName,
    idNumber: idNumber,
    birthDate: birthDate,
    phoneNumber: phoneNumber,
    note: note,
    hasVisa: hasVisa,
    status: "طلب جديد",
    createdAt: dateStr,
    createdAtIso: now.toISOString()
  };

  if (hasVisa) {
    orderData.visaDetails = {
      visaNumber: document.getElementById('visaNumber').value || '',
      visaIssueDate: document.getElementById('visaIssueDate').value || '',
      borderNumber: document.getElementById('borderNumber').value || '',
      employerName: document.getElementById('employerName').value || '',
      workCity: document.getElementById('workCity').value || '',
      address: document.getElementById('address').value || '',
      relativeName: document.getElementById('relativeName').value || '',
      relativeRelation: document.getElementById('relativeRelation').value || '',
      relativePhone: document.getElementById('relativePhone').value || '',
      relativeEmployer: document.getElementById('relativeEmployer').value || '',
      homeFloors: document.getElementById('homeFloors').value || '',
      homeRooms: document.getElementById('homeRooms').value || '',
      familyMembers: document.getElementById('familyMembers').value || ''
    };
  }

  try {
    await addDoc(collection(db, "orders"), orderData);

    if (currentSelectedCvDocId) {
      await updateDoc(doc(db, "cvs", currentSelectedCvDocId), { status: "مؤرشف" });
    }

    // إرسال الإشعار فوراً لتليجرام
    sendTelegramNotification(orderData, fullTimeFormatted);

    alert(`شكراً لك ${applicantName}، تم استلام طلبك بنجاح! وسنتواصل معك على رقم (${phoneNumber}) قريباً.`);
    closeModal();
    loadProducts();
  } catch (e) {
    console.error("خطأ الإرسال:", e);
    alert("حدث خطأ أثناء إرسال الطلب، يرجى المحاولة مرة أخرى.");
  }
};

// تشغيل جلب الإعلانات والمنتجات بالتوازي عند تحميل الصفحة
Promise.all([
  loadAnnouncements(),
  loadProducts()
]);