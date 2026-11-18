# OCI A1.Flex capacity checker

Checks every 5 seconds whether Oracle Cloud has capacity for `VM.Standard.A1.Flex`
(4 OCPU / 24 GB) in your region, and beeps when it finds some.

## Setup

1. Install Node.js 18+, then run `npm install` in this folder.
2. In the OCI Console: Profile → **My profile** → **API keys** → **Add API key**.
   Download the private key, then copy the "Configuration file preview" into
   `C:\Users\<you>\.oci\config`.
3. Put the `.pem` key in that `.oci` folder and set
   `key_file=C:/Users/<you>/.oci/oci_api_key.pem` in the config.

## Run

```
node a1-checker.js
```

Stop with **Ctrl+C**. To change the shape, size or interval, edit the constants at the top of `a1-checker.js`.
