import {
  CdkCustomResourceEvent,
  CdkCustomResourceResponse,
  Context,
} from "aws-lambda";

import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { OsRole, OsRoleMapping } from "./types";
import { env } from "process";

interface ResourceProperties {
  OsEndpoint: string;
  LambdaRoleArn: string; // Lambda cannot reflect on its own assigned role, we need to set this as a security admin
  RoleMappings: OsRoleMapping[];
}

export const handler = async (
  event: CdkCustomResourceEvent<ResourceProperties>,
  context: Context,
): Promise<CdkCustomResourceResponse> => {
  console.log("Lambda is invoked with:", event);

  const osClient = new Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION!,
      service: "es",
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: `https://${event.ResourceProperties.OsEndpoint}`,
  });

  const baseRoleMapping: OsRoleMapping = {
    osRole: OsRole.SECURITY_MANAGER,
    iamRoleArns: [event.ResourceProperties.LambdaRoleArn],
  };

  let roleMappings: OsRoleMapping[] = event.ResourceProperties.RoleMappings;

  // Drop blank ARNs (e.g. an unset AgentHealthReaderArn parameter) and any
  // mapping left with no ARNs, so we don't write an empty backend_roles list.
  roleMappings = roleMappings
    .map((m) => ({
      ...m,
      iamRoleArns: (m.iamRoleArns || []).filter((arn) => arn && arn.trim()),
    }))
    .filter((m) => m.iamRoleArns.length > 0);

  if (event.RequestType == "Delete") {
    for (let roleMapping of roleMappings) {
      if (roleMapping.osRole == OsRole.SECURITY_MANAGER) {
        await setRoleMapping(osClient, baseRoleMapping);
      } else {
        await deleteRoleMapping(osClient, roleMapping.osRole);
      }
    }
    return {};
  }

  const mergedRoleMappings = mergeRoleMappings(roleMappings, [baseRoleMapping]);

  console.log("Effective role mappings:", mergedRoleMappings);

  if (event.RequestType == "Update") {
    // make sure to remove role mappings that are not needed anymore
    for (const oldRoleMapping of event.OldResourceProperties.RoleMappings) {
      if (
        !mergedRoleMappings.find(
          (mapping) => mapping.osRole == oldRoleMapping.osRole,
        )
      ) {
        await deleteRoleMapping(osClient, oldRoleMapping.osRole);
      }
    }
  }

  for (let roleMapping of mergedRoleMappings) {
    await setRoleMapping(osClient, roleMapping);
  }

  return {};
};

async function setRoleMapping(client: Client, mapping: OsRoleMapping) {
  console.info("Setting roleMapping", mapping);
  try {
    // PATCH `replace` on /backend_roles updates an EXISTING mapping in place,
    // leaving any users/hosts entries on it untouched.
    const response = await client.security.patchRoleMapping({
      role: mapping.osRole,
      body: [
        {
          op: "replace",
          path: "/backend_roles",
          value: mapping.iamRoleArns,
        },
      ],
    });
    console.info("Response from OS:", response);
    return;
  } catch (e: any) {
    // A mapping that doesn't exist yet (e.g. `readall`, which has a role but no
    // default rolesmapping document) returns 404. Fall back to the bulk
    // rolesmapping PATCH with an `add` op to create just this mapping, without
    // overwriting any other mappings (unlike a full PUT).
    if (e?.meta?.statusCode !== 404) throw e;
  }

  console.info("Mapping not found; creating via bulk add", mapping.osRole);
  const createResponse = await client.security.patchRoleMappings({
    body: [
      {
        op: "add",
        path: `/${mapping.osRole}`,
        value: { backend_roles: mapping.iamRoleArns },
      },
    ],
  });
  console.info("Response from OS:", createResponse);
  if (createResponse.statusCode! > 299) {
    throw new Error(
      `Error from OpenSearch, status ${createResponse.statusCode}, response: ${createResponse.body}`,
    );
  }
}

function mergeRoleMappings(
  mappings1: OsRoleMapping[],
  mappings2: OsRoleMapping[],
): OsRoleMapping[] {
  let mergedMappings = mappings1;
  for (let mapping2 of mappings2) {
    const matchingIndex = mergedMappings.findIndex(
      (mapping) => mapping.osRole == mapping2.osRole,
    );
    if (matchingIndex == -1) {
      //not found
      mergedMappings.push(mapping2);
    } else {
      mergedMappings[matchingIndex].iamRoleArns.push(...mapping2.iamRoleArns);
    }
  }
  return mergedMappings;
}

async function deleteRoleMapping(client: Client, role: string) {
  console.info("Deleting roleMapping", role);
  const response = await client.security.deleteRoleMapping({
    role,
  });
  console.info("Response from OS:", response);
  if (response.statusCode! > 299) {
    throw new Error(
      `Error from OpenSearch, status ${response.statusCode}, response: ${response.body}`,
    );
  }
}
