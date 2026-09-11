// cv-script.js - الربط الديناميكي مع المظهر الجديد
const fieldsMap = {
  'inputCode': 'cvCode',
  'inputName': 'cvName',
  'inputWeight': 'cvWeight',
  'inputHeight': 'cvHeight',
  'inputReligion': 'cvReligion',
  'inputAge': 'cvAge',
  'inputPassport': 'cvPassport',
  'inputExpTitle': 'cvExpTitle',
  'inputJob': 'cvJob',
  'inputDuration': 'cvDuration',
  'inputExpCountry': 'cvExpCountry',
  'inputMarital': 'cvMarital',
  'inputChildren': 'cvChildren',
  'inputBirthPlace': 'cvBirthPlace',
  'inputEnglish': 'cvEnglish',
  'inputArabic': 'cvArabic',
  'inputEducation': 'cvEducation',
  'inputBabyCare': 'cvBabyCare',
  'inputCleaning': 'cvCleaning',
  'inputElderlyCare': 'cvElderlyCare',
  'inputWashing': 'cvWashing',
  'inputCooking': 'cvCooking',
  'inputIroning': 'cvIroning'
};

// الاستماع المباشر للتعديلات في المدخلات
Object.keys(fieldsMap).forEach(inputId => {
  const inputEl = document.getElementById(inputId);
  const targetEl = document.getElementById(fieldsMap[inputId]);

  if (inputEl && targetEl) {
    inputEl.addEventListener('input', () => {
      targetEl.innerText = inputEl.value;
    });
  }
});

// تغيير لون عنوان حالة الخبرة تلقائياً عند الاختيار
const expTitleColorSelect = document.getElementById('inputExpTitleColor');
const expTitleTarget = document.getElementById('cvExpTitle');

if (expTitleColorSelect && expTitleTarget) {
  expTitleColorSelect.addEventListener('change', function() {
    expTitleTarget.style.color = this.value;
  });
}

// حساب العمر تلقائياً بموجب تاريخ الميلاد
const birthDateInput = document.getElementById('inputBirthDate');
const ageInput = document.getElementById('inputAge');
const cvAgeTarget = document.getElementById('cvAge');

if (birthDateInput && ageInput && cvAgeTarget) {
  birthDateInput.addEventListener('change', function () {
    const birthDate = new Date(this.value);
    if (!isNaN(birthDate.getTime())) {
      const today = new Date();
      let calculatedAge = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        calculatedAge--;
      }

      ageInput.value = calculatedAge;
      cvAgeTarget.innerText = calculatedAge;
    }
  });
}

// تحديث اسم الدولة وعلمها تلقائياً
const countrySelect = document.getElementById('inputCountrySelect');
const countryNameEl = document.getElementById('cvCountryName');
const flagImgEl = document.getElementById('cvFlagImg');

if (countrySelect) {
  countrySelect.addEventListener('change', function() {
    const selectedOption = countrySelect.options[countrySelect.selectedIndex];
    countryNameEl.innerText = selectedOption.value;
    flagImgEl.src = selectedOption.getAttribute('data-flag');
    flagImgEl.style.display = 'block';
  });
}

// معاينة صورة العاملة فور الرفع
document.getElementById('inputPhoto').addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const photoContainer = document.getElementById('photoContainer');
      photoContainer.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;" alt="صورة العاملة">`;
    };
    reader.readAsDataURL(file);
  }
});

// تصدير القالب بصيغة صورة PNG عالية الجودة
function downloadCVAsPNG() {
  const cvElement = document.getElementById('cvCard');
  const codeValue = document.getElementById('inputCode').value.trim() || 'جديد';

  const options = {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff'
  };

  html2canvas(cvElement, options).then((canvas) => {
    const imageURI = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `CV_DarAlNukhba_${codeValue}.png`;
    link.href = imageURI;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }).catch((error) => {
    console.error('خطأ أثناء تصدير الصورة:', error);
    alert('حدث خطأ أثناء استخراج الصورة، يرجى إعادة المحاولة.');
  });
}