const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentIntentId, email, firstName, lastName, companyName, offer, partnerId,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, gbraid, msclkid, twclid } = req.body || {};

  if (!paymentIntentId || !email || !firstName || !lastName) {
    return res.status(400).json({ error: 'paymentIntentId, email, firstName, and lastName are required' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const signupApiKey = process.env.TRIAL_SIGNUP_API_KEY;

  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not configured');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const stripe = Stripe(secretKey);

  try {
    // Verify payment actually succeeded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment has not been completed.' });
    }

    let provisioned = false;

    // Provision account via the trial-signup API on the main BT app
    if (signupApiKey) {
      try {
        const signupRes = await fetch('https://my.brokertoolkit.app/api/trial-signup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': signupApiKey,
          },
          body: JSON.stringify({
            email: email.trim(),
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            companyName: companyName || '',
            // Pass UTM/attribution for tracking
            utm_source: utm_source || 'aime',
            utm_medium: utm_medium || 'partner',
            utm_campaign: utm_campaign || 'aim-vendor-offer',
            utm_content: utm_content || '',
            utm_term: utm_term || '',
            fbclid: fbclid || '',
            gclid: gclid || '',
            gbraid: gbraid || '',
            msclkid: msclkid || '',
            twclid: twclid || '',
          })
        });

        const signupData = await signupRes.json().catch(() => ({}));

        if (!signupRes.ok) {
          console.error('Trial signup API error:', signupRes.status, signupData);
          // 409 = account already exists — still a valid outcome (they can just log in)
          if (signupRes.status === 409) {
            return res.status(200).json({
              success: true,
              accountExists: true,
              message: 'Payment confirmed. An account with this email already exists — you can sign in at my.brokertoolkit.app.',
            });
          }
          // Other errors: payment succeeded but provisioning failed — flag for manual follow-up
        } else {
          provisioned = true;
        }
      } catch (signupErr) {
        console.error('Trial signup API call failed:', signupErr);
        // Payment is confirmed; log and continue — ops can manually provision
      }
    } else {
      console.warn('TRIAL_SIGNUP_API_KEY not set — account provisioning skipped');
    }

    // Store Stripe payment intent metadata for linking to the account
    try {
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...paymentIntent.metadata,
          provisioned: provisioned ? 'true' : 'false',
          offer: offer || 'aim-7day',
          partnerId: partnerId || 'aime',
        }
      });
    } catch (metaErr) {
      console.warn('Failed to update payment intent metadata:', metaErr.message);
    }

    return res.status(200).json({
      success: true,
      provisioned,
      message: provisioned
        ? 'Payment confirmed and account created. Check your email for login details.'
        : 'Payment confirmed. Your account is being set up — you\'ll receive an email shortly. If you don\'t hear from us within 10 minutes, email support@brokertoolkit.app.',
    });

  } catch (err) {
    console.error('finalize error:', err);
    return res.status(500).json({ error: err.message || 'Account setup failed.' });
  }
};
