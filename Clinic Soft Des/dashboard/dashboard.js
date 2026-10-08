// Interactive JS behavior for Clinic Booking System Dashboard

document.addEventListener('DOMContentLoaded', () => {
    // Action Buttons
    const profileBtn = document.getElementById('profileBtn');
    const bookAppointmentBtn = document.getElementById('bookAppointmentBtn');
    const viewAppointmentsBtn = document.getElementById('viewAppointmentsBtn');

    // Desktop Action Buttons
    const deskBookBtn = document.getElementById('deskBookBtn');
    const deskViewBtn = document.getElementById('deskViewBtn');

    // Simple interaction logic
    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            alert('Profile Settings: Feature coming soon!');
        });
    }

    const handleBookingClick = () => {
        console.log('Navigating to Appointment Booking system...');
        alert('Redirecting to the online appointment booking scheduler...');
    };

    const handleViewClick = () => {
        console.log('Fetching user appointment list...');
        alert('Loading your upcoming appointments schedule...');
    };

    if (bookAppointmentBtn) {
        bookAppointmentBtn.addEventListener('click', handleBookingClick);
    }
    if (deskBookBtn) {
        deskBookBtn.addEventListener('click', handleBookingClick);
    }

    if (viewAppointmentsBtn) {
        viewAppointmentsBtn.addEventListener('click', handleViewClick);
    }
    if (deskViewBtn) {
        deskViewBtn.addEventListener('click', handleViewClick);
    }

    // Add visual tap/click micro-interactions for tactile feel on mobile
    const buttons = document.querySelectorAll('.action-card, .profile-btn, .mobile-logout-btn, .desktop-logout-btn, .feature-icon-wrapper, .desktop-hero-actions button');
    buttons.forEach(btn => {
        btn.addEventListener('touchstart', () => {
            btn.style.transform = 'scale(0.97)';
        });
        btn.addEventListener('touchend', () => {
            btn.style.transform = '';
        });
    });
});
