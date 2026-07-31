# Alexa Development Skill Setup

This guide configures the private `en-GB` custom skill. Version 1 does not use
account linking; one fixed household resolver and one Todoist project are
configured behind an interface that can later be replaced.

## Create and build the skill

1. Sign in to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask).
2. Choose **Create Skill**.
3. Enter a skill name such as `Household List`, select **English (UK)**, choose
   **Custom**, and choose your preferred hosting option that allows an external
   AWS Lambda endpoint.
4. Open **Interaction Model → JSON Editor**.
5. Paste [`../alexa/interaction-models/en-GB.json`](../alexa/interaction-models/en-GB.json).
6. Change `invocationName` before importing if `household list` is rejected or
   reserved. Keep the utterances and handlers unchanged.
7. Save and build the model. Resolve any console validation errors before
   continuing.

`AMAZON.SearchQuery` deliberately captures broad product phrases rather than a
fixed grocery vocabulary. Dialog prompts elicit a missing `item` slot and
confirm `ClearCompletedIntent`.

## Connect Lambda

1. Copy the exact skill ID (`amzn1.ask.skill...`) from the console.
2. Supply it as Terraform `alexa_skill_id`; this also becomes
   `ALEXA_SKILL_ID`.
3. Build and deploy the service by following the root README.
4. Copy Terraform output `alexa_lambda_arn`.
5. In the Alexa console, open **Endpoint**, choose **AWS Lambda ARN**, and paste
   the ARN as the default region endpoint.
6. Save the endpoint.

The Lambda permission restricts `alexa-appkit.amazon.com` to that skill ID.
The ASK SDK performs application skill-ID verification again in-process.

## Test privately

1. Open the **Test** tab and enable testing for **Development**.
2. Use the Alexa simulator with the example phrases in the README.
3. Sign the Alexa app and Echo device into the same Amazon developer account.
4. Invoke the skill on the Echo using its configured invocation name.
5. Verify add/list/complete/remove against the dedicated Todoist project.
6. For clear-completed, confirm that the skill asks before deleting and that a
   denial leaves Todoist unchanged.

Do not enable distribution or public certification for version 1. Do not add
Amazon's deprecated List Management API or synchronize Alexa's native list.

## Local fixture invocation

The local command uses the same real Secrets Manager and Todoist boundaries:

```bash
npm run invoke:alexa -- tests/fixtures/alexa/launch-request.json
```

The fixture contains placeholders only. Its `applicationId` must match the
configured `ALEXA_SKILL_ID`. A passing fixture is not evidence that Alexa's
real signing, routing, model, or device behavior works; record deployed testing
separately in the implementation log.
