const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentIntentId, email, firstName, lastName, companyName, offer, partnerId } = req.body || {};

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

    // Provision account via existing signup API (same as trial-signup but with partner context)
    if (signupApiKey) {
      try {
        const provisionRes = await fetch('https://brokertoolkit.app/api/provision', {
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
            offer: offer || 'aim-7day',
            partnerId: partnerId || 'aime',
            stripePaymentIntentId: paymentIntentId,
          })
        });

        if (!provisionRes.ok) {
          const provisionData = await provisionRes.json().catch(() => ({}));
          console.error('Provision API error:', provisionRes.status, provisionData);
          // Don't fail the whole flow — payment succeeded, flag for manual follow-up
        }
      } catch (provisionErr) {
        console.error('Provision API call failed:', provisionErr);
        // Payment is confirmed; log and continue — ops can manually provision
      }
    } else {
      console.warn('TRIAL_SIGNUP_API_KEY not set — account provisioning skipped');
    }

    return res.status(200).json({
      success: true,
      message: 'Payment confirmed. Check your email for access details.',
    });

  } catch (err) {
    console.error('finalize error:', err);
    return res.status(500).json({ error: err.message || 'Account setup failed.' });
  }
};
