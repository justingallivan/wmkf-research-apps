// Stateless registered entry types. No test rule, API key, HTTP, environment
// lookup, mutable policy setting or caller-controlled binding is used here.
using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;
namespace Wmkf.PromptPublication;
public sealed class PublishPromptPlugin : IPlugin
{
    public void Execute(IServiceProvider provider)=>PluginInvocation.Publish(provider,ReleaseBindings.Packaged());
}
public sealed class PromptPublicationGuardPlugin : IPlugin
{
    public void Execute(IServiceProvider provider)=>PluginInvocation.Guard(provider,ReleaseBindings.Packaged());
}
public static class PluginInvocation
{
    private static T Service<T>(IServiceProvider provider) where T:class=>provider.GetService(typeof(T)) as T??throw new InvalidPluginExecutionException("plugin_service_missing");
    public static void Publish(IServiceProvider provider,ReleaseBindings bindings)
    {
        var c=Service<IPluginExecutionContext>(provider);bindings.AssertBound(c,true);
        PublicationWire.Require(c.InputParameters.Count==1&&c.InputParameters.TryGetValue(ReleaseBindings.RequestParameter,out var value)&&value is string,"invalid_plugin_request");
        var factory=Service<IOrganizationServiceFactory>(provider);var authority=new PublicationWriteAuthority(bindings.Organization,ReleaseBindings.ApiMessage,bindings.Extension);
        var sdk=new TransactionSdk(c,factory,bindings.Organization,authority);var service=factory.CreateOrganizationService(c.UserId)??throw new InvalidPluginExecutionException("sdk_service_missing");
        var authorization=new PublisherAuthorization(c,factory,bindings.Organization,bindings.Publishers,bindings.ExecutePrivilege);var store=new PublicationSdkStore(c,factory,bindings.Organization,authorization,authority);
        var result=PublicationPublisher.Publish((string)c.InputParameters[ReleaseBindings.RequestParameter],store,new ProductionPublicationRules(sdk,service,bindings.Organization,bindings.Enabled));
        c.OutputParameters[ReleaseBindings.ResponseParameter]=PublicationWire.Json(result);
        // No catch: fault must abort the platform transaction. Output before
        // platform completion is provisional; external retry keeps SAME UUID.
    }
    public static void Guard(IServiceProvider provider,ReleaseBindings bindings)
    {
        var c=Service<IPluginExecutionContext>(provider);bindings.AssertBound(c,false);
        PublicationWire.Require(new[]{PromptRows.Table,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,ProductionPublicationRules.Settings}.Contains(c.PrimaryEntityName,StringComparer.Ordinal),"guard_registration_table_mismatch");
        PublicationWire.Require(c.MessageName=="Create"||c.MessageName=="Update"||c.MessageName=="Delete","bulk_or_alternate_write_denied");
        PublicationWire.Require(c.InputParameters.TryGetValue("Target",out var raw),"guard_target_required");
        var target=raw as Entity;if(raw is EntityReference reference&&c.MessageName=="Delete")target=new Entity(reference.LogicalName,reference.Id);
        PublicationWire.Require(target!=null,"guard_target_required");Entity? preimage=null;
        if(c.MessageName!="Create"){PublicationWire.Require(c.PreEntityImages!=null&&c.PreEntityImages.TryGetValue(ReleaseBindings.Preimage,out preimage),"guard_preimage_required");}
        var authority=new PublicationWriteAuthority(bindings.Organization,ReleaseBindings.ApiMessage,bindings.Extension);
        if(c.PrimaryEntityName==ProductionPublicationRules.Settings)SettingsWriteGuard.Assert(c,target!,preimage,authority);
        else PublicationWriteGuard.Assert(c,target!,preimage,PublicationSdkStore.HeadTable,PublicationSdkStore.ReceiptTable,authority);
    }
}
