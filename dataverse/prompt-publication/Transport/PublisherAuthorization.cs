// Caller-context authorization, never SYSTEM. Release configuration is server-owned.
// Privilege names/IDs and approved human IDs MUST come from reviewed provisioning.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Metadata;
using Microsoft.Crm.Sdk.Messages;
using Newtonsoft.Json.Linq;

namespace Wmkf.PromptPublication;

public sealed class PublisherAuthorization
{
    private readonly IPluginExecutionContext context;
    private readonly IOrganizationService service;
    private readonly Guid organization;
    private readonly HashSet<Guid> approved;
    private readonly string executePrivilege;
    public PublisherAuthorization(IPluginExecutionContext context,IOrganizationServiceFactory factory,Guid organization,IEnumerable<Guid> approvedHumans,string executePrivilege)
    {
        this.context=context??throw new ArgumentNullException(nameof(context));this.organization=organization;
        approved=new HashSet<Guid>(approvedHumans??throw new ArgumentNullException(nameof(approvedHumans)));
        this.executePrivilege=executePrivilege;
        PublicationWire.Require(organization!=Guid.Empty&&approved.Count>0&&!approved.Contains(Guid.Empty)
            &&executePrivilege!=null&&Regex.IsMatch(executePrivilege,@"\Aprv[A-Za-z0-9_]+\z"),"publisher_release_binding_required");
        AssertContext();service=(factory??throw new ArgumentNullException(nameof(factory))).CreateOrganizationService(context.UserId)??throw new InvalidOperationException("sdk_service_missing");
    }
    private void AssertContext() => PublicationWire.Require(context.OrganizationId==organization&&context.UserId!=Guid.Empty&&context.InitiatingUserId!=Guid.Empty&&context.Mode==0&&context.IsInTransaction&&!context.IsExecutingOffline&&!context.IsOfflinePlayback&&approved.Contains(context.UserId),"publisher_not_authorized");
    private void Privilege(Guid user,string name,bool global,Guid expectedPrivilege)
    {
        // Newer message includes effective team depth; RetrieveUserPrivileges is
        // insufficient (it flattens team grants to Basic).
        var request=new OrganizationRequest("RetrieveUserPrivilegeByPrivilegeName");request["UserId"]=user;request["PrivilegeName"]=name;
        var response=service.Execute(request);
        PublicationWire.Require(response.Results.TryGetValue("RolePrivileges",out var value)&&value is RolePrivilege[] roles&&roles.Length>0&&roles.All(p=>p!=null&&p.PrivilegeId==expectedPrivilege)&&(!global||roles.Any(p=>p.Depth==PrivilegeDepth.Global)),"publisher_privilege_required");
    }
    public JObject Authorize()
    {
        AssertContext();
        // Effective actor must be an enabled interactive human. Initiating actor
        // may be the Admin application principal; SDK impersonation intersection
        // remains enforced by Dataverse. Never accept an actor from input JSON.
        var user=service.Retrieve("systemuser",context.UserId,new ColumnSet("isdisabled","applicationid","accessmode"));
        PublicationWire.Require(user.Id==context.UserId&&user.LogicalName=="systemuser"&&user.Attributes.TryGetValue("isdisabled",out var disabled)&&disabled is bool b&&!b
            &&(!user.Attributes.TryGetValue("applicationid",out var app)||app==null||app is Guid g&&g==Guid.Empty)
            &&user.Attributes.TryGetValue("accessmode",out var mode)&&mode is OptionSetValue option&&option.Value==0,"publisher_human_required");
        // Resolve each Read privilege from THAT published table's metadata;
        // arbitrary configuration strings cannot substitute unrelated grants.
        foreach(var table in new[]{PromptRows.Table,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable})
        {
            var metadata=((RetrieveEntityResponse)service.Execute(new RetrieveEntityRequest{LogicalName=table,EntityFilters=EntityFilters.Entity|EntityFilters.Privileges,RetrieveAsIfPublished=false})).EntityMetadata;
            PublicationWire.Require(metadata!=null&&metadata.LogicalName==table&&metadata.Privileges!=null,"publisher_privilege_metadata_required");
            var reads=metadata!.Privileges!.Where(p=>p.PrivilegeType==PrivilegeType.Read).ToArray();
            PublicationWire.Require(reads.Length==1&&reads[0].PrivilegeId!=Guid.Empty&&!string.IsNullOrWhiteSpace(reads[0].Name),"publisher_read_privilege_binding_required");
            if(table==PublicationSdkStore.ReceiptTable)
            {
                var create=metadata.Privileges!.Where(p=>p.PrivilegeType==PrivilegeType.Create).ToArray();
                PublicationWire.Require(create.Length==1&&create[0].Name==executePrivilege&&create[0].PrivilegeId!=Guid.Empty,"publisher_execute_privilege_binding_required");
                Privilege(context.UserId,executePrivilege,false,create[0].PrivilegeId);
            }
            Privilege(context.UserId,reads[0].Name,true,reads[0].PrivilegeId);
        }
        AssertContext();return PublicationWire.Actor(context.OrganizationId,context.InitiatingUserId,context.UserId);
    }
}
