namespace BankerGameWeb.Models
{
    public class BankerOffer
    {
        public decimal Amount { get; set; }
        public int Round { get; set; }
        public string Message { get; set; } = string.Empty;
        public bool WasAccepted { get; set; }
    }
}
