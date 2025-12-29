namespace BankerGameWeb.Models;

public class SpecialGift
{
    public string Name { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public int TriggeredByEliminationOrder { get; set; }
}
