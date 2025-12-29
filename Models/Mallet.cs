namespace BankerGameWeb.Models
{
    public class Mallet
    {
        public int Number { get; set; }
        public Prize? Prize { get; set; }
        public bool IsOpen { get; set; }
        public bool IsSelected { get; set; }
    }
}
