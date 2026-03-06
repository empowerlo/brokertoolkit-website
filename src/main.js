/* Broker Toolkit — Main JS */
(function () {
  'use strict';

  // Mobile nav toggle with hamburger/X swap
  var hamburger = document.querySelector('.nav-hamburger');
  var navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
      // Swap hamburger ↔ X
      hamburger.innerHTML = isOpen
        ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    });
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      });
    });
  }

  // Scroll-based nav background
  var nav = document.querySelector('nav');
  if (nav) {
    function updateNav() {
      if (window.scrollY > 50) {
        nav.classList.add('nav-scrolled');
      } else {
        nav.classList.remove('nav-scrolled');
      }
    }
    updateNav();
    window.addEventListener('scroll', updateNav, { passive: true });
  }

  // Fade-in on scroll with staggered delays for grids
  var observerOptions = { threshold: 0.1, rootMargin: '0px 0px -40px 0px' };
  var fadeObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-in-visible');
        fadeObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Apply fade-in to key elements
  var fadeTargets = document.querySelectorAll('.feature-card, .pricing-card, .feature-detail, .screenshot-frame, .section-header, .cta-bar, .cta-content, .comparison-table, .section-explore-tools');
  fadeTargets.forEach(function (el) {
    el.classList.add('fade-in');
    fadeObserver.observe(el);
  });

  // Add staggered delays to cards in grids
  document.querySelectorAll('.features-grid').forEach(function (grid) {
    var cards = grid.querySelectorAll('.feature-card');
    cards.forEach(function (card, i) {
      if (i < 4) card.classList.add('delay-' + (i + 1));
    });
  });

  // Modal handler for trial signup
  (function () {
    var modal = document.getElementById('trialModal');
    var form = document.getElementById('trial-signup-form');
    var statusEl = document.getElementById('joinStatus');
    var submitBtn = document.getElementById('submitBtn');
    var closeModalBtn = document.getElementById('closeModal');
    var openButtons = Array.from(document.querySelectorAll('.js-open-trial'));
    var params = new URLSearchParams(window.location.search);
    var attribution = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || ''
    };

    function track(eventName, extra) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({
        event: eventName,
        page_path: window.location.pathname
      }, attribution, extra || {}));
    }

    function openModal() {
      if (modal) {
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(function () {
          var emailInput = document.getElementById('email');
          if (emailInput) emailInput.focus();
        }, 10);
        track('trial_signup_modal_open');
      }
    }

    function closeModal() {
      if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
      }
    }

    if (modal && form) {
      openButtons.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          openModal();
        });
      });

      if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
      }

      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeModal();
        }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var payload = {
          email: String(fd.get('email') || '').trim(),
          firstName: String(fd.get('firstName') || '').trim(),
          lastName: String(fd.get('lastName') || '').trim(),
          companyName: String(fd.get('companyName') || '').trim()
        };
        Object.assign(payload, attribution);
        payload.fbclid = params.get('fbclid') || '';
        payload.gclid = params.get('gclid') || '';
        payload.gbraid = params.get('gbraid') || '';
        payload.msclkid = params.get('msclkid') || '';
        payload.twclid = params.get('twclid') || '';

        if (!payload.email || !payload.firstName || !payload.lastName) {
          statusEl.textContent = 'Please complete all required fields.';
          statusEl.className = 'join-status err';
          track('trial_signup_validation_error', { reason: 'missing_required_fields' });
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        statusEl.textContent = '';
        statusEl.className = 'join-status';
        track('trial_signup_submit', { has_company: !!payload.companyName });

        fetch('/api/trial-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (res) {
          return res.json().catch(function () {
            return {};
          }).then(function (data) {
            if (!res.ok) {
              if (res.status === 409) {
                var signInUrl = 'https://my.brokertoolkit.app';
                statusEl.innerHTML = 'An account with this email already exists. <a href="' + signInUrl + '" target="_blank" rel="noopener" style="color:#c7d2fe;text-decoration:underline;">Sign in here</a>.';
                statusEl.className = 'join-status err';
                track('trial_signup_conflict', { has_company: !!payload.companyName });
                return;
              }
              throw new Error(data.error || 'Signup failed');
            }
            track('trial_signup_success', { has_company: !!payload.companyName });
            statusEl.textContent = 'Success. Your free trial request was submitted.';
            statusEl.className = 'join-status ok';
            form.reset();
          });
        }).catch(function (err) {
          track('trial_signup_error', { error_message: err.message || 'unknown_error' });
          statusEl.textContent = 'Sorry, we could not submit your request. Please try again.';
          statusEl.className = 'join-status err';
        }).finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Unlock Free Trial';
        });
      });
    }
  })();
})();
