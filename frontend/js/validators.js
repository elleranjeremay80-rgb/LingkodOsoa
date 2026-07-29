/* ===================================================
   LINGKOD Meneses - Shared Validators
   Pure validation rules/functions - no DOM dependency, no assumption
   about which page loaded them. Originally lived inside js/auth-forms.js
   for the three pre-auth pages only; split out here once a second,
   authenticated-side page (Registered Users' Edit User modal) needed the
   exact same "is this a valid email" rule rather than inventing its own.
   Load this on any page that validates one of these shapes - it doesn't
   need auth-forms.js's UI helpers (status banners, password toggles)
   alongside it to be useful.
   =================================================== */

const LINGKOD_PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const LINGKOD_PASSWORD_MESSAGE = "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";
const LINGKOD_NAME_RULE = /^[A-Za-z' -]+$/;
const LINGKOD_NAME_MESSAGE = "May only contain letters, spaces, apostrophes, and hyphens.";
const LINGKOD_STUDENT_NUMBER_MESSAGE = "Student Number must contain exactly 10 digits.";
const LINGKOD_EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINGKOD_EMAIL_MESSAGE = "Please enter a valid email address.";

function lingkodIsPasswordValid(value){
    return LINGKOD_PASSWORD_RULE.test(value || "");
}

function lingkodIsNameValid(value){
    const trimmed = (value || "").trim();
    return trimmed.length > 0 && LINGKOD_NAME_RULE.test(trimmed);
}

function lingkodIsStudentNumberValid(value){
    return /^\d{10}$/.test((value || "").trim());
}

function lingkodIsEmailValid(value){
    return LINGKOD_EMAIL_RULE.test((value || "").trim());
}
