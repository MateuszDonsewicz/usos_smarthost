const express = require('express');
const axios = require('axios');
const oauth1a = require('oauth-1.0a');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const ejs = require('ejs');

const app = express();
const port = 3000;

// Configure OAuth
const oauth = oauth1a({
  consumer: {
    key: '82xwD377tKqEjGm8fCDj',
    secret: 'DvtbWdfBdryLkCLCcQrPdLC9zbDPGgmfpz5u6Wch',
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto
      .createHmac('sha1', key)
      .update(base_string)
      .digest('base64');
  },
});

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

app.get('/staff', async (req, res) => {
  console.log('Request received:', req.query.query, req.query.page);

  const searchApiUrl = 'https://usosapps.impan.pl/services/users/search2';
  const page = parseInt(req.query.page) || 0;
  const searchParams = {
    lang: 'en',
    fields: 'items|next_page',
    query: req.query.query || '',
    among: 'current_staff',
    num: 20,
    start: page * 20,
    format: 'json',
  };

  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: searchApiUrl,
      method: 'GET',
      data: searchParams,
    })
  );

  try {
    const searchResponse = await axios.get(searchApiUrl, {
      params: searchParams,
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    const searchResults = searchResponse.data;
    console.log('Search results:', searchResults);

    const staffData = [];

    if (searchResults.items) {
      for (const staffMember of searchResults.items) {
        const userId = staffMember.user.id;
        const userApiUrl = 'https://usosapps.impan.pl/services/users/user';
        const userParams = {
          user_id: userId,
          fields: 'first_name|last_name|email|email_access|phone_numbers|staff_status|employment_positions',
          format: 'json',
        };

        const userAuthHeader = oauth.toHeader(
          oauth.authorize({
            url: userApiUrl,
            method: 'GET',
            data: userParams,
          })
        );

        const userResponse = await axios.get(userApiUrl, {
          params: userParams,
          headers: {
            ...userAuthHeader,
            'Content-Type': 'application/json',
          },
        });

        const userDetails = userResponse.data;

        console.log(
          `User: ${userDetails.first_name} ${userDetails.last_name}, Staff Status: ${userDetails.staff_status}`
        );

        let email = userDetails.email || '';
        if (userDetails.email_access) {
          switch (userDetails.email_access) {
            case 'no_access':
              email = 'Brak dostępu do emaila';
              break;
            case 'require_captcha':
              email = 'Wymagane CAPTCHA do dostępu do emaila';
              break;
            case 'plaintext':
              email = userDetails.email;
              break;
            default:
              email = 'Brak informacji o emailu';
          }
        }

        // Get current employment position
        const employmentPositions = userDetails.employment_positions || [];
        console.log('Employment Positions for user', userId, ':', employmentPositions); // Logging the positions
        let currentPosition = 'Brak informacji';
        if (employmentPositions.length > 0) {
          currentPosition = employmentPositions[0].position.name.en || employmentPositions[0].position.name.pl || 'Brak informacji';
        }

        staffData.push({
          user_id: userId,
          name: `${userDetails.first_name} ${userDetails.last_name}`,
          email: email,
          email_access: userDetails.email_access,
          phone_numbers: userDetails.phone_numbers || [],
          staff_status: userDetails.staff_status,
          employment_position: currentPosition,
        });
      }
    }

    const academicPositions = ['Professor', 'Adiunkt', 'Profesor Instytutu'];
    const administrativePositions = [
      'redaktor', 'kierownik działu wydawnictw', 'specjalista ds. zamówień publicznych', 'asystent Dyrektora',
      'starszy referent', 'referent', 'recepcjonista', 'komputerowy składacz tekstu', 'Kustosz dyplomowany',
      'pokojowa', 'samodzielny referent', 'samodzielna księgowa', 'specjalista ds. obsługi badań',
      'starszy programista', 'informatyk', 'główny księgowy'
    ];

    const academicStaff = staffData.filter((member) => academicPositions.includes(member.employment_position));
    const nonAcademicStaff = staffData.filter((member) => administrativePositions.includes(member.employment_position));

    academicStaff.sort((a, b) => a.name.localeCompare(b.name));
    nonAcademicStaff.sort((a, b) => a.name.localeCompare(b.name));

    res.render('staff_table', {
      academic_staff: academicStaff,
      non_academic_staff: nonAcademicStaff,
      next_page: searchResults.next_page,
      current_page: page,
      query: req.query.query || '',
    });
  } catch (error) {
    console.error('Error fetching staff data:', error);
    res.status(500).send('Internal Server Error');
  }
});

// CAPTCHA verification route
app.get('/verify-captcha', async (req, res) => {
  const userId = req.query.user_id;
  const captchaApiUrl = `https://usosapps.impan.pl/services/users/user?user_id=${userId}&fields=email&format=json&captcha=true`;

  const authHeader = oauth.toHeader(
    oauth.authorize({
      url: captchaApiUrl,
      method: 'GET',
    })
  );

  try {
    const captchaResponse = await axios.get(captchaApiUrl, {
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    });

    const captchaImageUrl = captchaResponse.data.captcha_image_url;  // Assume the API returns this field
    console.log('CAPTCHA Image URL:', captchaImageUrl);  // Log the CAPTCHA Image URL for debugging

    res.render('captcha_verification', {
      user_id: userId,
      captcha_image_url: captchaImageUrl, // Update variable name to match template
      auth_header: JSON.stringify(authHeader),
    });    
  } catch (error) {
    console.error('Error fetching CAPTCHA image:', error);
    res.status(500).send('Error fetching CAPTCHA image');
  }
});

app.post('/verify-captcha', async (req, res) => {
  const { user_id, captcha_response, auth_header } = req.body;
  const captchaUrl = `https://usosapps.impan.pl/services/users/user?user_id=${user_id}&fields=email&format=json`;

  const authHeader = JSON.parse(auth_header);

  try {
    const captchaResponse = await axios.get(captchaUrl, {
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
        'captcha-response': captcha_response,
      },
    });

    const email = captchaResponse.data.email;

    res.send(`Email for user ${user_id}: ${email}`);
  } catch (error) {
    console.error('Error verifying CAPTCHA:', error);
    res.status(500).send('Error verifying CAPTCHA');
  }
});

// Employment groups route
app.get('/employment-groups', async (req, res) => {
  const employmentGroupsUrl = 'https://usosapps.impan.pl/services/users/employment_groups_index';
  
  const params = {
    fields: 'id|name|university_teachers',
    format: 'json',
  };
  
  try {
    const response = await axios.get(employmentGroupsUrl, {
      params,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const employmentGroups = response.data;
    console.log('Employment Groups:', employmentGroups);
    
    res.render('employment_groups', { employment_groups: employmentGroups });
  } catch (error) {
    console.error('Error fetching employment groups:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Employment group details route
app.get('/employment-group/:id', async (req, res) => {
  const employmentGroupId = req.params.id;
  const employmentGroupUrl = `https://usosapps.impan.pl/services/users/employment_group`;
  
  const params = {
    id: employmentGroupId,
    fields: 'id|name|university_teachers',
    format: 'json',
  };
  
  try {
    const response = await axios.get(employmentGroupUrl, {
      params,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const employmentGroupDetails = response.data;
    console.log('Employment Group Details:', employmentGroupDetails);
    
    res.render('employment_group_details', { employment_group: employmentGroupDetails });
  } catch (error) {
    console.error('Error fetching employment group details:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
